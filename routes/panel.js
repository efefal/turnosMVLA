// routes/panel.js — Endpoints protegidos del panel de empleados
//
// Todos los endpoints requieren JWT válido (verificarJWT como primer middleware).
//
// Permisos por rol (definido en el JWT):
//   operador  → ve y opera su propia agenda, carga presencial, bloqueos propios
//   encargado → todo lo anterior + cancelación masiva, bloqueos de oficina,
//               ver agenda de otros operadores, editar mensajes de confirmación
//
// El campo req.usuario.areaIds limita qué áreas puede ver cada usuario.
// Un operador solo ve turnos de sus propias áreas y solo los suyos.
// Un encargado ve todos los turnos de sus áreas y puede filtrar por operador.

'use strict';

const router = require('express').Router();
const pool   = require('../db');
const motor  = require('../motor');
const logger = require('../logger');
const bcrypt = require('bcrypt');
const { verificarJWT } = require('../middleware/auth');

// Todos los endpoints de este router requieren autenticación
router.use(verificarJWT);


// =============================================================================
// HELPERS INTERNOS (no se exportan)
// =============================================================================

// Retorna true si el usuario tiene rol 'sistemas' (acceso total sin restricción de área)
function esSistemas(req) {
  return req.usuario.rol === 'sistemas';
}

// Retorna true si el usuario tiene rol 'encargado' (solo dentro de sus áreas)
function esEncargado(req) {
  return req.usuario.rol === 'encargado';
}

// Retorna true si el usuario tiene rol 'directivo' (solo lectura, sin modificaciones)
function esDirectivo(req) {
  return req.usuario.rol === 'directivo';
}

// Retorna true si el usuario tiene rol 'encargado' O 'sistemas'
// Usar esta función para endpoints que deben excluir a operadores y directivos
function esEncargadoOSistemas(req) {
  return req.usuario.rol === 'encargado' || req.usuario.rol === 'sistemas';
}

// Respuesta estándar para el rol directivo cuando intenta modificar datos.
// Se llama al inicio de cualquier endpoint POST, PATCH o DELETE.
function rechazarDirectivo(res) {
  return res.status(403).json({
    error: 'Acceso de solo lectura. Este rol no puede realizar modificaciones.'
  });
}

// Retorna true si el areaId dado está entre las áreas del usuario.
// El rol 'sistemas' tiene acceso a cualquier área sin restricción.
function tieneAccesoAlArea(req, areaId) {
  if (esSistemas(req)) return true;
  return req.usuario.areaIds.includes(parseInt(areaId, 10));
}

// B9: Determina el array de areaIds a usar para filtrar datos.
// Si el frontend envía areas[] (para el selector de área), valida y usa esas.
// Para sistemas/directivo sin áreas especificadas: null = sin filtro (ven todo).
// Para encargado/operador sin áreas especificadas: usa las del token JWT.
function resolverAreaIds(req, areasQuery) {
  const areasParam = areasQuery
    ? [].concat(areasQuery).map(Number).filter(Boolean)
    : null;

  if (esSistemas(req) || esDirectivo(req)) {
    if (areasParam?.length) return areasParam;
    return null; // null = sin restricción de área
  }

  const { areaIds } = req.usuario;
  if (!areasParam?.length) return areaIds;
  return areasParam.filter(id => areaIds.includes(id));
}

// Valida el formato del nombre de usuario de login (columna `usuario`).
// Reglas: 3-50 caracteres, minúsculas/números/punto/guion bajo, no puede
// empezar con punto ni guion bajo (evita nombres raros tipo "._admin").
const USUARIO_REGEX = /^[a-z0-9][a-z0-9._]{2,49}$/;
function esUsuarioValido(usuario) {
  return USUARIO_REGEX.test(usuario);
}

// Inserta un registro en la tabla de auditoría.
// Se llama desde todos los endpoints que modifican datos.
async function auditar(usuarioId, entidadTipo, entidadId, accion, detalle, ip) {
  await pool.query(
    `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal, ip)
     VALUES (?, ?, ?, ?, ?, 'panel', ?)`,
    [usuarioId, entidadTipo, entidadId, accion, JSON.stringify(detalle), ip || null]
  );
}


// =============================================================================
// CAMBIO DE CONTRASEÑA
// =============================================================================

// POST /panel/auth/cambiar-clave
// Cambia la contraseña del usuario logueado.
// Obligatorio cuando debe_cambiar_clave=TRUE (primer login con clave temporal).
// También disponible para cambio voluntario de cualquier usuario autenticado.
router.post('/auth/cambiar-clave', async (req, res) => {
  const { clave_nueva } = req.body;

  if (!clave_nueva || clave_nueva.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
  }

  try {
    const hash = await bcrypt.hash(clave_nueva, 10);

    await pool.query(
      'UPDATE usuarios SET password_hash = ?, debe_cambiar_clave = FALSE WHERE id = ?',
      [hash, req.usuario.id]
    );

    await auditar(req.usuario.id, 'usuario', req.usuario.id, 'modificar', {
      accion_detalle: 'cambio de contraseña',
      usuario: req.usuario.nombre,
    }, req.ip);

    logger.info(`[panel] Contraseña cambiada por ${req.usuario.nombre} (ID ${req.usuario.id})`);
    res.json({ ok: true });

  } catch (err) {
    logger.error('[panel] Error al cambiar contraseña:', err);
    res.status(500).json({ error: 'No se pudo cambiar la contraseña.' });
  }
});


// =============================================================================
// VECINOS
// =============================================================================

// GET /panel/vecino/:dni
// Busca un vecino por DNI. El formulario presencial lo usa para pre-completar
// el nombre y el teléfono cuando el vecino ya está registrado en el sistema.
// También devuelve los IDs de servicios con turno activo para que el frontend
// pueda advertir al empleado al seleccionar el trámite, sin esperar al 409 al confirmar.
// Devuelve { existe, nombre, telefono, turnosActivosServicioIds } o { existe: false, turnosActivosServicioIds: [] }.
router.get('/vecino/:dni', async (req, res) => {
  const { dni } = req.params;

  try {
    const [rows] = await pool.query(
      'SELECT id, nombre, telefono FROM vecinos WHERE dni = ?',
      [dni]
    );

    if (rows.length === 0) {
      return res.json({ existe: false, turnosActivosServicioIds: [] });
    }

    const vecino = rows[0];

    // IDs de servicios con turno activo futuro — para anti-abuso temprano en el frontend
    const [turnos] = await pool.query(`
      SELECT servicio_id FROM turnos
      WHERE vecino_id = ? AND estado = 'agendado'
        AND (fecha > CURDATE() OR (fecha = CURDATE() AND hora_inicio > CURTIME()))
    `, [vecino.id]);

    res.json({
      existe:   true,
      nombre:   vecino.nombre,
      telefono: vecino.telefono || '',
      turnosActivosServicioIds: turnos.map(t => t.servicio_id),
    });
  } catch (err) {
    logger.error('[panel] Error al buscar vecino por DNI:', err);
    res.status(500).json({ error: 'No se pudo buscar el vecino.' });
  }
});


// =============================================================================
// AGENDA
// =============================================================================

// GET /panel/agenda/rango?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&operadorId=N
// Devuelve turnos de un rango de fechas en una sola llamada.
// Las vistas "semana" y "mes" de agenda.html usan este endpoint para evitar
// hacer 7 o 31 llamadas individuales al endpoint /agenda.
//
// NOTA: esta ruta DEBE ir ANTES de GET /agenda, de lo contrario Express intenta
// hacer coincidir la palabra "rango" con el parámetro :fecha — no hay problema
// técnico (son paths distintos) pero el orden explícito documenta la intención.
router.get('/agenda/rango', async (req, res) => {
  const { desde, hasta } = req.query;
  const operadorId = req.query.operadorId ? parseInt(req.query.operadorId, 10) : null;

  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Los parámetros desde y hasta son obligatorios.' });
  }

  try {
    // B1/B9: resolverAreaIds devuelve null para sistemas/directivo sin selector (ven todo).
    const areasFiltro = resolverAreaIds(req, req.query['areas[]']);

    const condiciones = ['t.fecha >= ?', 't.fecha <= ?', "t.estado != 'cancelado'"];
    const params      = [desde, hasta];

    if (areasFiltro !== null && areasFiltro.length > 0) {
      condiciones.push(`s.area_id IN (${areasFiltro.map(() => '?').join(',')})`);
      params.push(...areasFiltro);
    }

    // Operador: sus propios turnos + los sin tomar de su área (para poder tomarlos).
    // Encargado, directivo y sistemas: todos los del área, con filtro opcional por operador.
    if (req.usuario.rol === 'operador') {
      condiciones.push('(t.operador_id = ? OR t.operador_id IS NULL)');
      params.push(req.usuario.id);
    } else if (operadorId) {
      condiciones.push('t.operador_id = ?');
      params.push(operadorId);
    }

    const [turnos] = await pool.query(`
      SELECT
        t.id,
        t.fecha,
        t.hora_inicio,
        t.hora_fin,
        t.estado,
        v.nombre AS vecino_nombre,
        v.dni    AS vecino_dni,
        s.nombre AS servicio_nombre,
        u.nombre AS operador_nombre
      FROM turnos t
      JOIN vecinos   v ON t.vecino_id   = v.id
      JOIN servicios s ON t.servicio_id = s.id
      LEFT JOIN usuarios  u ON t.operador_id = u.id
      WHERE ${condiciones.join(' AND ')}
      ORDER BY t.fecha ASC, t.hora_inicio ASC
    `, params);

    res.json(turnos);
  } catch (err) {
    logger.error('[panel] Error al obtener agenda por rango:', err);
    res.status(500).json({ error: 'No se pudo obtener la agenda.' });
  }
});


// GET /panel/agenda?fecha=YYYY-MM-DD&operadorId=N
// Devuelve los turnos del día con datos de vecino, servicio y operador.
// Un operador solo ve sus propios turnos. Un encargado puede filtrar por operadorId.
router.get('/agenda', async (req, res) => {
  const fecha      = req.query.fecha || new Date().toISOString().substring(0, 10);
  const operadorId = req.query.operadorId ? parseInt(req.query.operadorId, 10) : null;

  try {
    // B1/B9: resolverAreaIds devuelve null para sistemas/directivo sin selector (ven todo).
    const areasFiltro = resolverAreaIds(req, req.query['areas[]']);

    const condiciones = ['t.fecha = ?', "t.estado != 'cancelado'"];
    const params      = [fecha];

    if (areasFiltro !== null && areasFiltro.length > 0) {
      condiciones.push(`s.area_id IN (${areasFiltro.map(() => '?').join(',')})`);
      params.push(...areasFiltro);
    }

    // Operador → sus propios turnos + los sin tomar de su área (para poder tomarlos).
    // Encargado, directivo y sistemas → todos los del área, con filtro opcional por operador.
    if (req.usuario.rol === 'operador') {
      condiciones.push('(t.operador_id = ? OR t.operador_id IS NULL)');
      params.push(req.usuario.id);
    } else if (operadorId) {
      condiciones.push('t.operador_id = ?');
      params.push(operadorId);
    }

    const [turnos] = await pool.query(`
      SELECT
        t.id,
        t.fecha,
        t.hora_inicio,
        t.hora_fin,
        t.estado,
        t.canal_origen,
        t.motivo_cancelacion,
        v.dni        AS vecino_dni,
        v.nombre     AS vecino_nombre,
        v.telefono   AS vecino_telefono,
        s.id         AS servicio_id,
        s.nombre     AS servicio_nombre,
        t.operador_id,
        u.nombre     AS operador_nombre,
        a.id         AS area_id,
        a.nombre     AS area_nombre
      FROM turnos t
      JOIN vecinos   v ON t.vecino_id   = v.id
      JOIN servicios s ON t.servicio_id = s.id
      LEFT JOIN usuarios  u ON t.operador_id = u.id
      JOIN areas     a ON s.area_id     = a.id
      WHERE ${condiciones.join(' AND ')}
      ORDER BY t.hora_inicio ASC
    `, params);

    res.json(turnos);
  } catch (err) {
    logger.error('[panel] Error al obtener agenda:', err);
    res.status(500).json({ error: 'No se pudo obtener la agenda.' });
  }
});


// GET /panel/buscar?q=texto
// Buscador global del panel (input .search-global de agenda.html).
// Busca en tres campos a la vez: DNI del vecino, nombre del vecino y
// número de turno (id exacto, solo si "q" son todos dígitos).
// Devuelve turnos (no vecinos sueltos) porque el resultado se usa para
// saltar directo a la vista día del turno encontrado.
router.get('/buscar', async (req, res) => {
  const q = (req.query.q || '').trim();
  const soloDigitos = /^\d+$/.test(q);

  // Menos de 2 caracteres da demasiado ruido en las búsquedas por LIKE
  // (nombre, DNI parcial) — sin índice sería un table scan grande para poco
  // resultado útil. No aplica al caso "solo dígitos, 1 dígito": ahí la
  // única búsqueda posible es t.id = ? (igualdad exacta sobre PK), y un
  // turno de 1 dígito es un resultado válido y la comparación es barata.
  if (!soloDigitos && q.length < 2) {
    return res.json([]);
  }

  try {
    // Mismo filtro de rol/área que /agenda y /agenda/rango, para que el
    // buscador nunca muestre turnos que el usuario no podría ver en la agenda.
    const areasFiltro = resolverAreaIds(req, req.query['areas[]']);

    const condiciones = ["t.estado != 'cancelado'"];
    const params      = [];
    const like = `%${q}%`;

    if (soloDigitos && q.length >= 2) {
      // 2+ dígitos: puede ser un n.º de turno, un DNI completo, o parte de un DNI.
      condiciones.push('(t.id = ? OR v.dni LIKE ?)');
      params.push(parseInt(q, 10), like);
    } else if (soloDigitos) {
      // 1 dígito: solo tiene sentido como ID de turno exacto. Un DNI de 1
      // dígito buscado por LIKE generaría demasiado ruido, así que esa
      // parte de la búsqueda se omite acá (mismo criterio que el gate de
      // arriba, aplicado solo a la sub-rama de DNI parcial).
      condiciones.push('t.id = ?');
      params.push(parseInt(q, 10));
    } else {
      condiciones.push('v.nombre LIKE ?');
      params.push(like);
    }

    if (areasFiltro !== null && areasFiltro.length > 0) {
      condiciones.push(`s.area_id IN (${areasFiltro.map(() => '?').join(',')})`);
      params.push(...areasFiltro);
    }

    if (req.usuario.rol === 'operador') {
      condiciones.push('(t.operador_id = ? OR t.operador_id IS NULL)');
      params.push(req.usuario.id);
    }

    const [turnos] = await pool.query(`
      SELECT
        t.id,
        t.fecha,
        t.hora_inicio,
        t.estado,
        v.dni    AS vecino_dni,
        v.nombre AS vecino_nombre,
        s.nombre AS servicio_nombre,
        u.nombre AS operador_nombre
      FROM turnos t
      JOIN vecinos   v ON t.vecino_id   = v.id
      JOIN servicios s ON t.servicio_id = s.id
      LEFT JOIN usuarios  u ON t.operador_id = u.id
      WHERE ${condiciones.join(' AND ')}
      ORDER BY t.fecha DESC, t.hora_inicio ASC
      LIMIT 15
    `, params);

    res.json(turnos);
  } catch (err) {
    logger.error('[panel] Error en buscador global:', err);
    res.status(500).json({ error: 'No se pudo realizar la búsqueda.' });
  }
});


// =============================================================================
// CALENDARIO — feriados y bloqueos (para agenda.html)
// =============================================================================

// GET /panel/feriados-bloqueos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&operadorId=N
// Devuelve los días especiales del rango para que agenda.html pueda marcarlos
// visualmente en las vistas semana y mes:
//
//   feriados:           ["YYYY-MM-DD", ...]
//   bloqueados:         ["YYYY-MM-DD", ...]   ← bloqueos de OFICINA de día completo
//   bloqueosIndividuales: { "YYYY-MM-DD": ["Nombre Op 1", ...] }
//
// Qué devuelve según el rol:
//   Operador:                   sus propios bloqueos individuales de día completo.
//   Encargado sin operadorId:   todos los bloqueos individuales de sus áreas.
//   Encargado con operadorId:   solo los bloqueos de ese operador.
//
// Solo se consideran bloqueos de día completo (hora_inicio IS NULL).
// Los bloqueos de hora específica no se incluyen: afectan un slot, no el día entero.
router.get('/feriados-bloqueos', async (req, res) => {
  const { desde, hasta } = req.query;
  const operadorIdFiltro = req.query.operadorId
    ? parseInt(req.query.operadorId, 10)
    : null;

  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Los parámetros desde y hasta son obligatorios.' });
  }

  try {
    // Feriados en el rango (incluye nacionales y locales de la tabla feriados)
    const [feriados] = await pool.query(
      'SELECT fecha FROM feriados WHERE fecha BETWEEN ? AND ? ORDER BY fecha',
      [desde, hasta]
    );

    // resolverAreaIds: null = sistemas/directivo sin filtro de área (ve todo),
    // igual que /panel/bloqueos — antes se usaba req.usuario.areaIds crudo, que
    // siempre filtraba por las áreas del JWT sin excepción de rol.
    const filtroAreas = resolverAreaIds(req, req.query.areas);
    let bloqueados           = [];
    const bloqueosIndividuales = {}; // { "YYYY-MM-DD": ["Sofía García", ...] }

    if (filtroAreas === null || filtroAreas.length > 0) {
      // ── Bloqueos de OFICINA de día completo ──────────────────────────────
      // Solo mostramos las áreas del usuario: un operador de Licencias no ve
      // los bloqueos de Tribunal de Faltas, que no le afectan. Sistemas y
      // directivo (filtroAreas === null) ven todas, sin condición de área.
      const condOficina   = ["tipo = 'oficina'", 'hora_inicio IS NULL'];
      const paramsOficina = [];
      if (filtroAreas !== null) {
        condOficina.push(`area_id IN (${filtroAreas.map(() => '?').join(',')})`);
        paramsOficina.push(...filtroAreas);
      }
      condOficina.push('fecha_inicio <= ?', 'fecha_fin >= ?');
      paramsOficina.push(hasta, desde);

      const [bloqueoOficina] = await pool.query(`
        SELECT fecha_inicio, fecha_fin
        FROM bloqueos
        WHERE ${condOficina.join(' AND ')}
      `, paramsOficina);

      bloqueoOficina.forEach(b => {
        const curDate = new Date(b.fecha_inicio.substring(0, 10) + 'T12:00:00');
        const finDate = new Date(b.fecha_fin.substring(0, 10)   + 'T12:00:00');
        while (curDate <= finDate) {
          bloqueados.push(curDate.toISOString().substring(0, 10));
          curDate.setDate(curDate.getDate() + 1);
        }
      });
      bloqueados = [...new Set(bloqueados)].sort();

      // ── Bloqueos INDIVIDUALES de día completo ─────────────────────────────
      // Qué operadores se incluyen según el rol y el filtro del dropdown:
      //   Operador regular             → solo sus propios bloqueos
      //   Encargado/sistemas/directivo sin filtro → todos los operadores del área
      //   Encargado/sistemas/directivo con filtro → solo ese operador específico
      const condInd   = ["b.tipo = 'individual'", 'b.hora_inicio IS NULL'];
      const paramsInd = [];
      if (filtroAreas !== null) {
        condInd.push(`b.area_id IN (${filtroAreas.map(() => '?').join(',')})`);
        paramsInd.push(...filtroAreas);
      }
      condInd.push('b.fecha_inicio <= ?', 'b.fecha_fin >= ?');
      paramsInd.push(hasta, desde);

      // Antes se usaba !esEncargado(req), que también restringía a sistemas y
      // directivo a "solo mis propios bloqueos" (ninguno de los dos es
      // 'encargado'). El chequeo correcto es por rol exacto — mismo patrón
      // que /panel/bloqueos ("Operador solo ve sus propios... Encargado,
      // sistemas y directivo ven todos").
      if (req.usuario.rol === 'operador') {
        condInd.push('b.usuario_id = ?');
        paramsInd.push(req.usuario.id);
      } else if (operadorIdFiltro) {
        // Encargado/sistemas/directivo con un operador específico en el dropdown
        condInd.push('b.usuario_id = ?');
        paramsInd.push(operadorIdFiltro);
      }
      // Encargado/sistemas/directivo sin filtro → no se agrega condición de usuario_id

      const [bloqueosInd] = await pool.query(`
        SELECT b.fecha_inicio, b.fecha_fin, u.nombre AS operador_nombre
        FROM   bloqueos  b
        JOIN   usuarios  u ON b.usuario_id = u.id
        WHERE  ${condInd.join(' AND ')}
        ORDER BY u.nombre ASC, b.fecha_inicio ASC
      `, paramsInd);

      // Expandir rangos individuales en días y agrupar por fecha.
      // Resultado: { "2026-06-10": ["Sofía García"], "2026-06-11": ["Sofía García", "Juan Pérez"] }
      bloqueosInd.forEach(b => {
        const nombre  = b.operador_nombre;
        const curDate = new Date(b.fecha_inicio.substring(0, 10) + 'T12:00:00');
        const finDate = new Date(b.fecha_fin.substring(0, 10)   + 'T12:00:00');
        while (curDate <= finDate) {
          const iso = curDate.toISOString().substring(0, 10);
          if (!bloqueosIndividuales[iso]) bloqueosIndividuales[iso] = [];
          // Deduplicar: el mismo operador puede tener bloqueos superpuestos
          if (!bloqueosIndividuales[iso].includes(nombre)) {
            bloqueosIndividuales[iso].push(nombre);
          }
          curDate.setDate(curDate.getDate() + 1);
        }
      });
    }

    res.json({
      feriados:  feriados.map(f => f.fecha.substring(0, 10)),
      bloqueados,
      bloqueosIndividuales,
    });

  } catch (err) {
    logger.error('[panel] Error al obtener feriados/bloqueos del calendario:', err);
    res.status(500).json({ error: 'No se pudieron obtener los días especiales.' });
  }
});


// =============================================================================
// TURNOS — detalle completo (vista de detalle del panel)
// =============================================================================

// GET /panel/turno/:id/completo
// Devuelve el turno con todos sus datos relacionados (vecino, servicio,
// operador, área) más el historial de turnos pasados del mismo vecino.
// Pensado para el modal de detalle de agenda.html (click en card de turno
// o selección de un resultado del buscador global).
//
// Acceso abierto a cualquier rol autenticado (mismo criterio que
// GET /panel/vecino/:dni) — incluido el historial completo del vecino.
// Lo que sí se valida es el área: un usuario no puede ver el detalle de
// un turno de un área a la que no tiene acceso, aunque adivine el ID.
router.get('/turno/:id/completo', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'ID de turno inválido.' });
  }

  try {
    const [turnoRows] = await pool.query(`
      SELECT
        t.id, t.fecha, t.hora_inicio, t.hora_fin, t.estado,
        t.canal_origen, t.motivo_cancelacion, t.created_at,
        t.notas, t.notas_actualizada_en,
        un.nombre  AS notas_actualizada_por_nombre,
        v.id       AS vecino_id,
        v.dni      AS vecino_dni,
        v.nombre   AS vecino_nombre,
        v.telefono AS vecino_telefono,
        s.id       AS servicio_id,
        s.nombre   AS servicio_nombre,
        t.operador_id,
        u.nombre   AS operador_nombre,
        a.id       AS area_id,
        a.nombre   AS area_nombre
      FROM turnos t
      JOIN vecinos   v ON t.vecino_id   = v.id
      JOIN servicios s ON t.servicio_id = s.id
      LEFT JOIN usuarios u  ON t.operador_id           = u.id
      LEFT JOIN usuarios un ON t.notas_actualizada_por = un.id
      JOIN areas     a ON s.area_id     = a.id
      WHERE t.id = ?
    `, [id]);

    if (turnoRows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado.' });
    }
    const turno = turnoRows[0];

    if (!tieneAccesoAlArea(req, turno.area_id)) {
      return res.status(403).json({ error: 'No tenés acceso a esta área.' });
    }

    // Historial: últimos 10 turnos pasados del mismo vecino (más reciente
    // primero), excluyendo el turno que se está mostrando. idx_turnos_vecino
    // ya cubre vecino_id, la consulta es barata.
    const [historial] = await pool.query(`
      SELECT
        t.id, t.fecha, t.hora_inicio, t.estado, t.notas,
        s.nombre AS servicio_nombre
      FROM turnos t
      JOIN servicios s ON t.servicio_id = s.id
      WHERE t.vecino_id = ? AND t.id != ?
      ORDER BY t.fecha DESC, t.hora_inicio DESC
      LIMIT 10
    `, [turno.vecino_id, id]);

    res.json({ turno, historial });
  } catch (err) {
    logger.error('[panel] Error al obtener detalle de turno:', err);
    res.status(500).json({ error: 'No se pudo obtener el detalle del turno.' });
  }
});


// PATCH /panel/turno/:id/notas
// Actualiza (o borra, si se manda vacío) la nota del turno. A diferencia
// de /turno/:id/estado, no tiene restricción de transición de estado —
// una nota es información de contexto, no depende de en qué estado esté
// el turno (ej. anotar por qué faltó alguien en un turno ya 'ausente').
// Sin restricción de "solo mis turnos asignados": el caso de uso es que
// cualquier operador del área pueda ver qué anotó otro, y un turno puede
// necesitar una nota antes de que nadie lo tome.
router.patch('/turno/:id/notas', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);

  const id = parseInt(req.params.id, 10);
  const { notas } = req.body;

  try {
    const [rows] = await pool.query(`
      SELECT t.id, s.area_id
      FROM   turnos t
      JOIN   servicios s ON t.servicio_id = s.id
      WHERE  t.id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado.' });
    }
    if (!tieneAccesoAlArea(req, rows[0].area_id)) {
      return res.status(403).json({ error: 'Sin permiso para modificar este turno.' });
    }

    // "Solo espacios" se guarda como NULL, no como string vacío/con espacios.
    const notasLimpias = (notas || '').trim() || null;

    await pool.query(
      'UPDATE turnos SET notas = ?, notas_actualizada_por = ?, notas_actualizada_en = NOW() WHERE id = ?',
      [notasLimpias, req.usuario.id, id]
    );

    await auditar(req.usuario.id, 'turno', id, 'modificar', {
      campo: 'notas',
      modificado_por: req.usuario.nombre,
    }, req.ip);

    res.json({
      ok: true,
      notas: notasLimpias,
      notas_actualizada_por: req.usuario.nombre,
      notas_actualizada_en: new Date(),
    });

  } catch (err) {
    logger.error('[panel] Error al actualizar notas del turno:', err);
    res.status(500).json({ error: 'No se pudieron guardar las notas.' });
  }
});


// =============================================================================
// TURNOS — tomar turno (asignar operador)
// =============================================================================

// PATCH /panel/turno/:id/tomar
// El operador presiona "Tomar" cuando el vecino llega a la ventanilla.
// Asigna operador_id = usuario logueado en el turno (que tenía operador_id NULL).
// Si otro operador ya lo tomó (race condition), el UPDATE no afecta filas y lanzamos error.
// Solo el área del servicio puede tomar el turno.
router.patch('/turno/:id/tomar', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);

  const id = parseInt(req.params.id, 10);

  try {
    // Verificar existencia del turno y acceso al área
    const [rows] = await pool.query(`
      SELECT t.id, t.operador_id, t.estado, s.area_id
      FROM   turnos t
      JOIN   servicios s ON t.servicio_id = s.id
      WHERE  t.id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado.' });
    }

    const turno = rows[0];

    if (!tieneAccesoAlArea(req, turno.area_id)) {
      return res.status(403).json({ error: 'Sin permiso para tomar este turno.' });
    }

    // Ejecutar la asignación en motor.js (con UPDATE condicional + auditoría)
    await motor.tomarTurno(id, req.usuario.id);

    // Devolver el turno actualizado con el nombre del operador para que el frontend
    // pueda actualizar la fila sin recargar toda la página.
    const [turnosActualizados] = await pool.query(`
      SELECT
        t.id, t.fecha, t.hora_inicio, t.hora_fin, t.estado, t.canal_origen,
        v.dni        AS vecino_dni,
        v.nombre     AS vecino_nombre,
        s.id         AS servicio_id,
        s.nombre     AS servicio_nombre,
        u.id         AS operador_id,
        u.nombre     AS operador_nombre
      FROM   turnos    t
      JOIN   vecinos   v ON t.vecino_id   = v.id
      JOIN   servicios s ON t.servicio_id = s.id
      LEFT JOIN usuarios u ON t.operador_id = u.id
      WHERE  t.id = ?
    `, [id]);

    logger.info(`[panel] Turno ${id} tomado por ${req.usuario.nombre}`);
    res.json(turnosActualizados[0]);

  } catch (err) {
    logger.error('[panel] Error al tomar turno:', err);
    res.status(409).json({ error: err.message || 'No se pudo tomar el turno.' });
  }
});


// PATCH /panel/turno/:id/liberar
// Desasigna el operador de un turno agendado, devolviéndolo al estado "sin tomar".
// Solo puede liberar el mismo operador que lo tomó, o un encargado/sistemas del área.
router.patch('/turno/:id/liberar', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);

  const id = parseInt(req.params.id, 10);

  try {
    const [rows] = await pool.query(`
      SELECT t.id, t.operador_id, t.estado, s.area_id
      FROM   turnos t
      JOIN   servicios s ON t.servicio_id = s.id
      WHERE  t.id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado.' });
    }

    const turno = rows[0];

    if (!tieneAccesoAlArea(req, turno.area_id)) {
      return res.status(403).json({ error: 'Sin permiso para liberar este turno.' });
    }

    if (turno.estado !== 'agendado') {
      return res.status(409).json({ error: 'Solo se pueden liberar turnos en estado agendado.' });
    }

    if (turno.operador_id === null) {
      return res.status(409).json({ error: 'El turno ya está sin operador asignado.' });
    }

    // Solo el operador que lo tomó puede liberarlo, salvo encargado o sistemas
    const esGestor = esEncargado(req) || esSistemas(req);
    if (!esGestor && turno.operador_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Solo podés liberar turnos que vos tomaste.' });
    }

    await pool.query('UPDATE turnos SET operador_id = NULL WHERE id = ?', [id]);

    await pool.query(
      `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal, ip)
       VALUES (?, 'turno', ?, 'modificar', ?, 'panel', ?)`,
      [
        req.usuario.id,
        id,
        JSON.stringify({ operacion: 'liberar', liberado_por: req.usuario.nombre }),
        req.ip || null,
      ]
    );

    const [actualizados] = await pool.query(`
      SELECT
        t.id, t.fecha, t.hora_inicio, t.hora_fin, t.estado, t.canal_origen,
        v.dni        AS vecino_dni,
        v.nombre     AS vecino_nombre,
        s.id         AS servicio_id,
        s.nombre     AS servicio_nombre,
        u.id         AS operador_id,
        u.nombre     AS operador_nombre
      FROM   turnos    t
      JOIN   vecinos   v ON t.vecino_id   = v.id
      JOIN   servicios s ON t.servicio_id = s.id
      LEFT JOIN usuarios u ON t.operador_id = u.id
      WHERE  t.id = ?
    `, [id]);

    logger.info(`[panel] Turno ${id} liberado por ${req.usuario.nombre}`);
    res.json(actualizados[0]);

  } catch (err) {
    logger.error('[panel] Error al liberar turno:', err);
    res.status(500).json({ error: 'No se pudo liberar el turno.' });
  }
});


// =============================================================================
// TURNOS — modificar estado
// =============================================================================

// PATCH /panel/turno/:id/estado
// Cambia el estado del turno: presente, ausente, atendido.
// NO permite cancelar desde acá — la cancelación usa DELETE /panel/turno/:id.
// Registra el estado anterior en auditoría para tener trazabilidad completa.
router.patch('/turno/:id/estado', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);

  const id    = parseInt(req.params.id, 10);
  const { estado } = req.body;

  const estadosPermitidos = ['presente', 'ausente', 'atendido'];
  if (!estado || !estadosPermitidos.includes(estado)) {
    return res.status(400).json({
      error: `Estado inválido. Valores permitidos: ${estadosPermitidos.join(', ')}.`
    });
  }

  try {
    const [rows] = await pool.query(`
      SELECT t.id, t.operador_id, t.estado, s.area_id
      FROM   turnos t
      JOIN   servicios s ON t.servicio_id = s.id
      WHERE  t.id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado.' });
    }

    const turno = rows[0];

    if (!tieneAccesoAlArea(req, turno.area_id)) {
      return res.status(403).json({ error: 'Sin permiso para modificar este turno.' });
    }

    // Operador solo puede cambiar el estado de sus propios turnos
    if (!esEncargado(req) && turno.operador_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Solo podés modificar tus propios turnos.' });
    }

    // Validar que la transición de estado tiene sentido.
    // Las transiciones válidas son:
    //   agendado → presente, ausente, atendido
    //   presente → atendido, ausente
    // Desde 'atendido', 'ausente' o 'cancelado' no se puede cambiar el estado.
    const transicionesValidas = {
      agendado: ['presente', 'ausente', 'atendido'],
      presente: ['atendido', 'ausente'],
    };

    if (!transicionesValidas[turno.estado]?.includes(estado)) {
      return res.status(409).json({
        error: `No se puede cambiar de "${turno.estado}" a "${estado}".`
      });
    }

    const estadoAnterior = turno.estado;

    await pool.query(
      'UPDATE turnos SET estado = ?, updated_at = NOW() WHERE id = ?',
      [estado, id]
    );

    await auditar(req.usuario.id, 'turno', id, 'modificar', {
      estado_anterior: estadoAnterior,
      estado_nuevo:    estado,
    }, req.ip);

    res.json({ ok: true, estado });

  } catch (err) {
    logger.error('[panel] Error al cambiar estado del turno:', err);
    res.status(500).json({ error: 'No se pudo actualizar el estado.' });
  }
});


// =============================================================================
// TURNOS — cancelar individual
// =============================================================================

// DELETE /panel/turno/:id
// Cancela un turno individual. Requiere motivo (mínimo 5 caracteres).
// Transacción: UPDATE turnos + INSERT auditoría son atómicos.
// Nota: NO llama a motor.cancelarCita() porque ese usa canal='bot' y usuario_id=NULL.
//   Acá necesitamos canal='panel' y el ID del empleado que cancela.
router.delete('/turno/:id', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);

  const id     = parseInt(req.params.id, 10);
  const { motivo } = req.body;

  if (!motivo || motivo.trim().length < 5) {
    return res.status(400).json({
      error: 'El motivo de cancelación es obligatorio (mínimo 5 caracteres).'
    });
  }

  try {
    // Solo permite cancelar turnos en estado 'agendado'
    const [rows] = await pool.query(`
      SELECT t.id, t.operador_id, t.estado, s.area_id
      FROM   turnos t
      JOIN   servicios s ON t.servicio_id = s.id
      WHERE  t.id = ? AND t.estado = 'agendado'
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado o ya no está agendado.' });
    }

    const turno = rows[0];

    if (!tieneAccesoAlArea(req, turno.area_id)) {
      return res.status(403).json({ error: 'Sin permiso para cancelar este turno.' });
    }

    const motivoTrim = motivo.trim();

    // Transacción para que el UPDATE y la auditoría sean atómicos.
    // Si falla la auditoría, el turno queda en estado 'agendado' (rollback).
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `UPDATE turnos
           SET estado = 'cancelado', motivo_cancelacion = ?, updated_at = NOW()
         WHERE id = ?`,
        [motivoTrim, id]
      );

      await conn.query(
        `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal, ip)
         VALUES (?, 'turno', ?, 'cancelar', ?, 'panel', ?)`,
        [
          req.usuario.id, id,
          JSON.stringify({ motivo: motivoTrim, cancelado_por: req.usuario.nombre }),
          req.ip || null,
        ]
      );

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    logger.info(`[panel] Turno ${id} cancelado por ${req.usuario.nombre} — "${motivoTrim}"`);
    res.json({ ok: true });

  } catch (err) {
    logger.error('[panel] Error al cancelar turno:', err);
    res.status(500).json({ error: 'No se pudo cancelar el turno.' });
  }
});


// =============================================================================
// TURNOS — cancelar masivo (solo encargados)
// =============================================================================

// DELETE /panel/turnos/masivo
// Cancela múltiples turnos por criterio: fecha, operadorId, servicioId.
// Al menos uno de los tres criterios es obligatorio.
// Solo encargados pueden hacer esto. Registra auditoría por cada turno cancelado.
//
// IMPORTANTE: esta ruta DEBE ir antes de DELETE /turno/:id para que Express
// no confunda "masivo" con un ID numérico.
router.delete('/turnos/masivo', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);
  if (!esEncargado(req)) {
    return res.status(403).json({ error: 'Solo los encargados pueden hacer cancelaciones masivas.' });
  }

  const { fecha, operadorId, servicioId, motivo } = req.body;

  if (!fecha && !operadorId && !servicioId) {
    return res.status(400).json({
      error: 'Se requiere al menos uno de: fecha, operadorId, servicioId.'
    });
  }

  if (!motivo || motivo.trim().length < 5) {
    return res.status(400).json({
      error: 'El motivo es obligatorio (mínimo 5 caracteres).'
    });
  }

  try {
    const { areaIds } = req.usuario;
    const motivoTrim  = motivo.trim();

    // Construir filtros dinámicos para los turnos a cancelar
    const condiciones = [
      "t.estado = 'agendado'",
      `s.area_id IN (${areaIds.map(() => '?').join(',')})`,
    ];
    const params = [...areaIds];

    if (fecha) {
      condiciones.push('t.fecha = ?');
      params.push(fecha);
    }
    if (operadorId) {
      condiciones.push('t.operador_id = ?');
      params.push(parseInt(operadorId, 10));
    }
    if (servicioId) {
      condiciones.push('t.servicio_id = ?');
      params.push(parseInt(servicioId, 10));
    }

    const [turnos] = await pool.query(`
      SELECT t.id
      FROM   turnos t
      JOIN   servicios s ON t.servicio_id = s.id
      WHERE  ${condiciones.join(' AND ')}
    `, params);

    if (turnos.length === 0) {
      return res.json({
        ok: true, cancelados: 0,
        mensaje: 'No hay turnos agendados que coincidan con los criterios.'
      });
    }

    const ids = turnos.map(t => t.id);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Cancelar todos en un solo UPDATE
      await conn.query(
        `UPDATE turnos
           SET estado = 'cancelado', motivo_cancelacion = ?, updated_at = NOW()
         WHERE id IN (${ids.map(() => '?').join(',')})`,
        [motivoTrim, ...ids]
      );

      // Registrar un registro de auditoría por cada turno cancelado
      for (const turnoId of ids) {
        await conn.query(
          `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal, ip)
           VALUES (?, 'turno', ?, 'cancelar', ?, 'panel', ?)`,
          [
            req.usuario.id, turnoId,
            JSON.stringify({ motivo: motivoTrim, cancelacion_masiva: true, cancelado_por: req.usuario.nombre }),
            req.ip || null,
          ]
        );
      }

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    logger.info(`[panel] Cancelación masiva: ${ids.length} turnos por ${req.usuario.nombre} — "${motivoTrim}"`);
    res.json({ ok: true, cancelados: ids.length });

  } catch (err) {
    logger.error('[panel] Error en cancelación masiva:', err);
    res.status(500).json({ error: 'No se pudieron cancelar los turnos.' });
  }
});


// =============================================================================
// TURNOS — carga presencial
// =============================================================================

// POST /panel/turno
// Registra un turno para un vecino que llega en persona.
// Usa motor.obtenerDisponibilidadServicio() para el round-robin de operadores,
// exactamente igual que el bot de WhatsApp y el selector web.
// Canal de origen: 'presencial'. El canal en auditoría es 'panel' (lo maneja motor.js).
router.post('/turno', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);

  const { dni, nombre, telefono, serviceId, fecha, horario } = req.body;

  if (!dni || !nombre || !serviceId || !fecha || !horario) {
    return res.status(400).json({
      error: 'Faltan datos. Se requieren: dni, nombre, serviceId, fecha, horario.'
    });
  }

  try {
    const serviceIdNum = parseInt(serviceId, 10);

    // Verificar si el vecino ya tiene un turno activo para este trámite.
    const [turnosActivos] = await pool.query(`
      SELECT id FROM turnos
      WHERE vecino_id = (SELECT id FROM vecinos WHERE dni = ?)
        AND servicio_id = ?
        AND estado = 'agendado'
        AND (fecha > CURDATE() OR (fecha = CURDATE() AND hora_inicio > CURTIME()))
      LIMIT 1
    `, [dni, serviceIdNum]);

    if (turnosActivos.length > 0) {
      return res.status(409).json({
        error: 'Este vecino ya tiene un turno activo para este trámite.'
      });
    }

    // Verificar que el slot está disponible.
    // En el nuevo modelo, mapaHorarioOperador tiene null en los valores —
    // usamos horariosLibres para saber si el slot tiene cupo.
    const disponibilidad = await motor.obtenerDisponibilidadServicio(serviceIdNum, fecha);
    if (!disponibilidad.horariosLibres.includes(horario)) {
      return res.status(409).json({
        error: `El horario ${horario} no está disponible para el servicio en la fecha ${fecha}.`
      });
    }

    // Necesitamos la duración del servicio para calcular la hora de fin
    const servicios = await motor.obtenerServicios();
    const servicio  = servicios.find(s => s.id === serviceIdNum);
    if (!servicio) {
      return res.status(404).json({ error: 'Servicio no encontrado.' });
    }

    const [hh, mm]    = horario.split(':').map(Number);
    const finMinutos  = hh * 60 + mm + servicio.duration;
    const finHH       = String(Math.floor(finMinutos / 60)).padStart(2, '0');
    const finMM       = String(finMinutos % 60).padStart(2, '0');
    const fechaHora    = `${fecha} ${horario}:00`;
    const fechaHoraFin = `${fecha} ${finHH}:${finMM}:00`;

    // crearCita() registra auditoría con usuario_id = usuarioPanelId (el empleado que carga).
    // Cambio 4: el panel pasa el ID del empleado para que la auditoría no quede con NULL.
    const cita = await motor.crearCita({
      dni, nombre, telefono: telefono || null,
      serviceId: serviceIdNum,
      fechaHora,
      fechaHoraFin,
      canal: 'presencial',
      usuarioPanelId: req.usuario.id,
    });

    logger.info(
      `[panel] Turno presencial ID ${cita.id} | DNI: ${dni} | por: ${req.usuario.nombre}`
    );
    res.status(201).json(cita);

  } catch (err) {
    logger.error('[panel] Error al crear turno presencial:', err);
    const esErrorNegocio = err.message?.includes('ya tiene un turno') ||
                           err.message?.includes('cupo del turno') ||
                           err.message?.includes('disponibilidad para ese horario');
    const status = esErrorNegocio ? 409 : 500;
    res.status(status).json({ error: err.message || 'No se pudo crear el turno.' });
  }
});


// =============================================================================
// DISPONIBILIDAD (para el formulario de carga presencial)
// =============================================================================

// GET /panel/disponibilidad?serviceId=N&fecha=YYYY-MM-DD
// Usa motor.obtenerDisponibilidadServicio() directamente (no el endpoint /api/disponibilidad
// de index.js, que todavía apunta a ea.js hasta el corte definitivo).
router.get('/disponibilidad', async (req, res) => {
  const { serviceId, fecha } = req.query;

  if (!serviceId || !fecha) {
    return res.status(400).json({
      error: 'Faltan parámetros: serviceId y fecha son obligatorios.'
    });
  }

  const serviceIdNum = parseInt(serviceId, 10);
  if (isNaN(serviceIdNum)) {
    return res.status(400).json({ error: 'serviceId debe ser un número entero.' });
  }

  try {
    const disponibilidad = await motor.obtenerDisponibilidadServicio(serviceIdNum, fecha);
    res.json(disponibilidad);
  } catch (err) {
    logger.error('[panel] Error al obtener disponibilidad:', err);
    res.status(500).json({ error: 'No se pudo obtener la disponibilidad.' });
  }
});


// =============================================================================
// BLOQUEOS
// =============================================================================

// GET /panel/bloqueos?areaId=N
// Devuelve bloqueos vigentes (fecha_fin >= hoy) del área del usuario.
// Operador: solo sus propios bloqueos individuales + bloqueos de oficina.
// Encargado: todos los bloqueos del área.
router.get('/bloqueos', async (req, res) => {
  // resolverAreaIds: null = sistemas/directivo sin filtro de área (ve todo),
  //   o array de IDs de áreas a filtrar (operadores y encargados)
  const filtroAreas = resolverAreaIds(req, req.query.areas);
  const hoy = new Date().toISOString().substring(0, 10);

  try {
    const condiciones = ['b.fecha_fin >= ?'];
    const params      = [hoy];

    if (filtroAreas !== null) {
      if (!filtroAreas.length) return res.json([]);
      condiciones.push(`b.area_id IN (${filtroAreas.map(() => '?').join(',')})`);
      params.push(...filtroAreas);
    }

    // Operador solo ve sus propios bloqueos individuales y los de oficina de su área.
    // Encargado, sistemas y directivo ven todos.
    if (req.usuario.rol === 'operador') {
      condiciones.push("(b.tipo = 'oficina' OR b.usuario_id = ?)");
      params.push(req.usuario.id);
    }

    const [bloqueos] = await pool.query(`
      SELECT
        b.id, b.tipo, b.fecha_inicio, b.fecha_fin,
        b.hora_inicio, b.hora_fin, b.motivo, b.created_at,
        u.nombre  AS operador_nombre,
        s.nombre  AS servicio_nombre,
        a.nombre  AS area_nombre,
        uc.nombre AS creado_por_nombre
      FROM      bloqueos  b
      LEFT JOIN usuarios  u  ON b.usuario_id  = u.id
      LEFT JOIN servicios s  ON b.servicio_id = s.id
      JOIN      areas     a  ON b.area_id     = a.id
      JOIN      usuarios  uc ON b.creado_por  = uc.id
      WHERE ${condiciones.join(' AND ')}
      ORDER BY b.fecha_inicio ASC, b.hora_inicio ASC
    `, params);

    res.json(bloqueos);

  } catch (err) {
    logger.error('[panel] Error al obtener bloqueos:', err);
    res.status(500).json({ error: 'No se pudieron obtener los bloqueos.' });
  }
});


// POST /panel/bloqueos
// Crea un bloqueo individual u oficina.
// Operador: solo puede bloquearse a sí mismo (tipo='individual').
// Encargado: puede crear bloqueos de oficina (tipo='oficina', usuario_id=null).
router.post('/bloqueos', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);

  const {
    tipo, usuario_id, servicio_id, area_id,
    fecha_inicio, fecha_fin, hora_inicio, hora_fin, motivo,
  } = req.body;

  if (!tipo || !area_id || !fecha_inicio || !fecha_fin || !motivo) {
    return res.status(400).json({
      error: 'Faltan datos. Requeridos: tipo, area_id, fecha_inicio, fecha_fin, motivo.'
    });
  }

  if (!['individual', 'oficina'].includes(tipo)) {
    return res.status(400).json({ error: "Tipo inválido. Valores: 'individual', 'oficina'." });
  }

  const areaIdNum = parseInt(area_id, 10);

  if (!tieneAccesoAlArea(req, areaIdNum)) {
    return res.status(403).json({ error: 'Sin permiso para crear bloqueos en esa área.' });
  }

  // Encargado y sistemas pueden crear bloqueos de oficina; operador solo individuales
  if (!esEncargadoOSistemas(req)) {
    if (tipo === 'oficina') {
      return res.status(403).json({ error: 'Solo los encargados pueden crear bloqueos de oficina.' });
    }
    // Operador solo puede bloquearse a sí mismo
    if (usuario_id && parseInt(usuario_id, 10) !== req.usuario.id) {
      return res.status(403).json({ error: 'Solo podés crear bloqueos para tu propia cuenta.' });
    }
  }

  // Para bloqueos de oficina el usuario_id es NULL (bloquea toda el área)
  const usuarioIdFinal = tipo === 'oficina'
    ? null
    : (usuario_id ? parseInt(usuario_id, 10) : req.usuario.id);

  try {
    const [result] = await pool.query(`
      INSERT INTO bloqueos
        (tipo, usuario_id, area_id, servicio_id, fecha_inicio, fecha_fin, hora_inicio, hora_fin, motivo, creado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tipo, usuarioIdFinal, areaIdNum,
      servicio_id ? parseInt(servicio_id, 10) : null,
      fecha_inicio, fecha_fin,
      hora_inicio || null,
      hora_fin    || null,
      motivo.trim(),
      req.usuario.id,
    ]);

    await auditar(req.usuario.id, 'bloqueo', result.insertId, 'bloquear', {
      tipo, fecha_inicio, fecha_fin, motivo: motivo.trim()
    }, req.ip);

    logger.info(`[panel] Bloqueo ${result.insertId} creado por ${req.usuario.nombre} (tipo: ${tipo})`);
    res.status(201).json({ ok: true, id: result.insertId });

  } catch (err) {
    logger.error('[panel] Error al crear bloqueo:', err);
    res.status(500).json({ error: 'No se pudo crear el bloqueo.' });
  }
});


// DELETE /panel/bloqueos/:id
// Elimina un bloqueo.
// Operador: solo puede eliminar sus propios bloqueos individuales.
// Encargado: puede eliminar cualquier bloqueo de su área.
router.delete('/bloqueos/:id', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);

  const id = parseInt(req.params.id, 10);

  try {
    const [rows] = await pool.query(
      'SELECT id, tipo, usuario_id, area_id FROM bloqueos WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Bloqueo no encontrado.' });
    }

    const bloqueo = rows[0];

    if (!tieneAccesoAlArea(req, bloqueo.area_id)) {
      return res.status(403).json({ error: 'Sin permiso para eliminar este bloqueo.' });
    }

    // Encargado y sistemas pueden eliminar bloqueos de oficina; operador solo los suyos
    if (!esEncargadoOSistemas(req)) {
      if (bloqueo.tipo === 'oficina') {
        return res.status(403).json({ error: 'Solo los encargados pueden eliminar bloqueos de oficina.' });
      }
      if (bloqueo.usuario_id !== req.usuario.id) {
        return res.status(403).json({ error: 'Solo podés eliminar tus propios bloqueos.' });
      }
    }

    await pool.query('DELETE FROM bloqueos WHERE id = ?', [id]);

    await auditar(req.usuario.id, 'bloqueo', id, 'desbloquear', {
      eliminado_por: req.usuario.nombre
    }, req.ip);

    res.json({ ok: true });

  } catch (err) {
    logger.error('[panel] Error al eliminar bloqueo:', err);
    res.status(500).json({ error: 'No se pudo eliminar el bloqueo.' });
  }
});


// =============================================================================
// MENSAJES DE CONFIRMACIÓN DE SERVICIOS
// =============================================================================

// GET /panel/servicios/:id/mensaje
// Devuelve el mensaje de confirmación del servicio.
// Usado en el panel para que el encargado pueda editarlo.
router.get('/servicios/:id/mensaje', async (req, res) => {
  const id = parseInt(req.params.id, 10);

  try {
    const [rows] = await pool.query(
      'SELECT id, nombre, mensaje_confirmacion FROM servicios WHERE id = ? AND activo = TRUE',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Servicio no encontrado.' });
    }

    res.json(rows[0]);

  } catch (err) {
    logger.error('[panel] Error al obtener mensaje del servicio:', err);
    res.status(500).json({ error: 'No se pudo obtener el mensaje.' });
  }
});


// PATCH /panel/servicios/:id/mensaje
// Actualiza el mensaje de confirmación. Solo encargados.
// El mensaje se muestra al vecino después de confirmar el turno.
router.patch('/servicios/:id/mensaje', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);
  if (!esEncargado(req)) {
    return res.status(403).json({
      error: 'Solo los encargados pueden modificar mensajes de confirmación.'
    });
  }

  const id          = parseInt(req.params.id, 10);
  const { mensaje } = req.body;

  if (!mensaje || mensaje.trim().length === 0) {
    return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, area_id FROM servicios WHERE id = ? AND activo = TRUE',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Servicio no encontrado.' });
    }

    const servicio = rows[0];

    // El encargado solo puede editar servicios de sus propias áreas
    if (!tieneAccesoAlArea(req, servicio.area_id)) {
      return res.status(403).json({ error: 'Sin permiso para modificar ese servicio.' });
    }

    await pool.query(
      'UPDATE servicios SET mensaje_confirmacion = ? WHERE id = ?',
      [mensaje.trim(), id]
    );

    await auditar(req.usuario.id, 'servicio', id, 'modificar', {
      campo:          'mensaje_confirmacion',
      modificado_por: req.usuario.nombre,
    }, req.ip);

    res.json({ ok: true });

  } catch (err) {
    logger.error('[panel] Error al actualizar mensaje del servicio:', err);
    res.status(500).json({ error: 'No se pudo actualizar el mensaje.' });
  }
});


// =============================================================================
// ENDPOINTS AUXILIARES (para poblar dropdowns del frontend)
// =============================================================================

// GET /panel/operadores?areaId=N
// Lista los operadores de las áreas del usuario.
// El encargado lo usa para el filtro de agenda por operador y para el formulario de bloqueos.
// Con ?areaId=N filtra solo ese área (para el selector de operador en bloqueos).
// Sistemas puede consultar cualquier área.
router.get('/operadores', async (req, res) => {
  const areaIdParam = req.query.areaId ? parseInt(req.query.areaId, 10) : null;

  // Validar que el área pedida esté dentro de las permitidas (salvo sistemas)
  if (areaIdParam && !tieneAccesoAlArea(req, areaIdParam)) {
    return res.status(403).json({ error: 'Sin acceso a esa área.' });
  }

  // Si se pidió un área específica, filtrar por esa. Si no, resolverAreaIds():
  // null = sistemas/directivo sin restricción (ve operadores de todas las áreas,
  // como dice el comentario de arriba — antes usaba areaIds crudo del JWT y no
  // cumplía esa promesa si sistemas no tenía usuario_areas para todas las áreas).
  const filtroAreas = areaIdParam ? [areaIdParam] : resolverAreaIds(req);

  if (filtroAreas !== null && !filtroAreas.length) {
    return res.json([]);
  }

  try {
    const condiciones = ['u.activo = TRUE', "ua.rol != 'directivo'"];
    const params = [];
    if (filtroAreas !== null) {
      condiciones.push(`ua.area_id IN (${filtroAreas.map(() => '?').join(',')})`);
      params.push(...filtroAreas);
    }

    const [operadores] = await pool.query(`
      SELECT DISTINCT u.id, u.nombre
      FROM   usuarios u
      JOIN   usuario_areas ua ON u.id = ua.usuario_id
      WHERE  ${condiciones.join(' AND ')}
      ORDER BY u.nombre ASC
    `, params);

    res.json(operadores);
  } catch (err) {
    logger.error('[panel] Error al obtener operadores:', err);
    res.status(500).json({ error: 'No se pudieron obtener los operadores.' });
  }
});


// GET /panel/servicios
// Lista los servicios de las áreas del usuario.
// El formulario presencial lo usa para el dropdown de trámites.
router.get('/servicios', async (req, res) => {
  try {
    let query;
    let params = [];

    // Sistemas tiene acceso completo sin restricción de área (igual que
    // /servicios/admin) — si no, un sistemas sin usuario_areas para un área
    // recién creada se queda sin ver sus servicios aunque el rol debería
    // ignorar esa restricción por completo.
    if (esSistemas(req)) {
      query = `
        SELECT id, nombre, duracion_min AS duration, area_id
        FROM   servicios
        WHERE  activo = TRUE
        ORDER BY nombre ASC
      `;
    } else {
      const { areaIds } = req.usuario;
      query = `
        SELECT id, nombre, duracion_min AS duration, area_id
        FROM   servicios
        WHERE  area_id IN (${areaIds.map(() => '?').join(',')})
          AND  activo = TRUE
        ORDER BY nombre ASC
      `;
      params = areaIds;
    }

    const [servicios] = await pool.query(query, params);
    res.json(servicios);
  } catch (err) {
    logger.error('[panel] Error al obtener servicios del panel:', err);
    res.status(500).json({ error: 'No se pudieron obtener los servicios.' });
  }
});


// =============================================================================
// N1 — AUDITORÍA
// =============================================================================

// GET /panel/auditoria
// Devuelve registros de auditoría paginados (50 por página).
// Encargado: solo ve registros de acciones de usuarios de sus áreas.
// Sistemas: ve todos los registros sin filtro de área.
//
// B6: cada registro incluye un campo `descripcion` legible (nombre del vecino, servicio, etc.)
// B7: acepta arrays de filtros: usuarios[], acciones[], entidades[]
//     Los valores antiguos usuarioId/accion/entidadTipo siguen funcionando para retro-compatibilidad.
router.get('/auditoria', async (req, res) => {
  if (!esEncargadoOSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol encargado o sistemas.' });
  }

  const { desde, hasta } = req.query;
  const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
  const limite = 50;
  const offset = (pagina - 1) * limite;

  // B7: normalizar arrays — Express puede enviar un solo valor o un array
  const usuariosArr  = [].concat(req.query['usuarios[]']  || req.query.usuarioId  || []).filter(Boolean).map(Number);
  const accionesArr  = [].concat(req.query['acciones[]']  || req.query.accion     || []).filter(Boolean);
  const entidadesArr = [].concat(req.query['entidades[]'] || req.query.entidadTipo || []).filter(Boolean);

  try {
    const condiciones = [];
    const params      = [];

    // B9: el frontend puede enviar areas[] para que sistemas/directivo filtren por área.
    // Para encargado, se usa la intersección de sus áreas con las pedidas.
    const areasB9 = req.query['areas[]']
      ? [].concat(req.query['areas[]']).map(Number).filter(id => tieneAccesoAlArea(req, id))
      : null;

    // El encargado solo ve acciones de usuarios de sus propias áreas.
    // Sistemas ve todo — salvo que aplique el filtro de área de B9.
    const areasFiltroAuditoria = areasB9 ?? (esSistemas(req) ? null : req.usuario.areaIds);

    if (areasFiltroAuditoria !== null && areasFiltroAuditoria.length > 0) {
      const ph = areasFiltroAuditoria.map(() => '?').join(',');
      condiciones.push(`(
        a.usuario_id IS NULL
        OR a.usuario_id = ?
        OR a.usuario_id IN (
          SELECT ua.usuario_id FROM usuario_areas ua WHERE ua.area_id IN (${ph})
        )
      )`);
      params.push(req.usuario.id, ...areasFiltroAuditoria);
    }

    if (desde)              { condiciones.push('a.timestamp >= ?'); params.push(desde + ' 00:00:00'); }
    if (hasta)              { condiciones.push('a.timestamp <= ?'); params.push(hasta + ' 23:59:59'); }
    if (usuariosArr.length) {
      condiciones.push(`a.usuario_id IN (${usuariosArr.map(() => '?').join(',')})`);
      params.push(...usuariosArr);
    }
    if (accionesArr.length) {
      condiciones.push(`a.accion IN (${accionesArr.map(() => '?').join(',')})`);
      params.push(...accionesArr);
    }
    if (entidadesArr.length) {
      condiciones.push(`a.entidad_tipo IN (${entidadesArr.map(() => '?').join(',')})`);
      params.push(...entidadesArr);
    }

    const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';

    const [conteo] = await pool.query(
      `SELECT COUNT(*) AS total FROM auditoria a ${where}`,
      params
    );
    const total = conteo[0].total;

    // B6: LEFT JOINs para obtener la descripción legible de la entidad afectada.
    // Cada tipo usa una tabla distinta, por eso hay muchos LEFT JOINs opcionales.
    const [registros] = await pool.query(`
      SELECT
        a.id,
        a.timestamp,
        u.nombre    AS usuario_nombre,
        u.usuario   AS usuario_login,
        a.accion,
        a.entidad_tipo,
        a.entidad_id,
        a.detalle,
        a.canal,
        a.ip,
        CASE a.entidad_tipo
          WHEN 'turno'    THEN ve.nombre
          WHEN 'servicio' THEN sv.nombre
          WHEN 'usuario'  THEN uu.nombre
          WHEN 'bloqueo'  THEN bl.motivo
          WHEN 'area'     THEN ar.nombre
          WHEN 'horario'  THEN uh.nombre
          ELSE NULL
        END AS descripcion
      FROM auditoria a
      LEFT JOIN usuarios  u  ON a.usuario_id = u.id
      LEFT JOIN turnos    t  ON a.entidad_tipo = 'turno'    AND t.id  = a.entidad_id
      LEFT JOIN vecinos   ve ON t.vecino_id = ve.id
      LEFT JOIN servicios sv ON a.entidad_tipo = 'servicio' AND sv.id = a.entidad_id
      LEFT JOIN usuarios  uu ON a.entidad_tipo = 'usuario'  AND uu.id = a.entidad_id
      LEFT JOIN bloqueos  bl ON a.entidad_tipo = 'bloqueo'  AND bl.id = a.entidad_id
      LEFT JOIN areas     ar ON a.entidad_tipo = 'area'     AND ar.id = a.entidad_id
      LEFT JOIN horarios  hh ON a.entidad_tipo = 'horario'  AND hh.id = a.entidad_id
      LEFT JOIN usuarios  uh ON hh.usuario_id = uh.id
      ${where}
      ORDER BY a.timestamp DESC
      LIMIT ? OFFSET ?
    `, [...params, limite, offset]);

    res.json({ registros, total, pagina, paginas: Math.ceil(total / limite) });

  } catch (err) {
    logger.error('[panel] Error al obtener auditoría:', err);
    res.status(500).json({ error: 'No se pudo obtener el registro de auditoría.' });
  }
});


// GET /panel/auditoria/usuarios — dropdown con usuarios del área para el filtro
// Devuelve solo los usuarios relevantes para el rol: el encargado ve su área, sistemas ve todos.
router.get('/auditoria/usuarios', async (req, res) => {
  if (!esEncargadoOSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso.' });
  }

  try {
    let query;
    let params = [];

    if (esSistemas(req)) {
      query = 'SELECT id, nombre, usuario FROM usuarios WHERE activo = TRUE ORDER BY nombre ASC';
    } else {
      const { areaIds } = req.usuario;
      const ph = areaIds.map(() => '?').join(',');
      query = `
        SELECT DISTINCT u.id, u.nombre, u.usuario
        FROM usuarios u
        JOIN usuario_areas ua ON u.id = ua.usuario_id
        WHERE ua.area_id IN (${ph})
        ORDER BY u.nombre ASC
      `;
      params = areaIds;
    }

    const [usuarios] = await pool.query(query, params);
    res.json(usuarios);
  } catch (err) {
    logger.error('[panel] Error al obtener usuarios para dropdown de auditoría:', err);
    res.status(500).json({ error: 'No se pudo obtener la lista de usuarios.' });
  }
});


// =============================================================================
// N2 — ESTADÍSTICAS / DASHBOARD
// =============================================================================

// GET /panel/estadisticas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Devuelve métricas de turnos para el período indicado.
// Encargado: solo datos de sus áreas. Sistemas: todas las áreas.
router.get('/estadisticas', async (req, res) => {
  if (!esEncargadoOSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol encargado o sistemas.' });
  }

  const { desde, hasta } = req.query;
  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Los parámetros desde y hasta son obligatorios.' });
  }

  try {
    // B9: resolverAreaIds permite que sistemas/directivo filtren por área desde el frontend.
    const areasFiltro = resolverAreaIds(req, req.query['areas[]']);

    const areaFiltro = areasFiltro === null ? ''
      : `AND s.area_id IN (${areasFiltro.map(() => '?').join(',')})`;
    const areaParams = areasFiltro ?? [];

    const base = `
      FROM turnos t
      JOIN servicios s ON t.servicio_id = s.id
      WHERE t.fecha BETWEEN ? AND ?
      ${areaFiltro}
    `;
    const baseParams = [desde, hasta, ...areaParams];

    // Totales por estado
    const [porEstado] = await pool.query(
      `SELECT t.estado, COUNT(*) AS cantidad ${base} GROUP BY t.estado`,
      baseParams
    );

    // Distribución por canal de origen
    const [porCanal] = await pool.query(
      `SELECT t.canal_origen, COUNT(*) AS cantidad ${base} GROUP BY t.canal_origen`,
      baseParams
    );

    // Operador con más turnos atendidos — LEFT JOIN por si algunos turnos aún no tienen operador
    const [porOperadorFinal] = await pool.query(`
      SELECT COALESCE(u.nombre, 'Sin asignar') AS operador, COUNT(*) AS atendidos
      FROM turnos t
      JOIN servicios s ON t.servicio_id = s.id
      LEFT JOIN usuarios  u ON t.operador_id = u.id
      WHERE t.fecha BETWEEN ? AND ?
        AND t.estado = 'atendido'
        ${areaFiltro}
      GROUP BY t.operador_id, u.nombre
      ORDER BY atendidos DESC
      LIMIT 5
    `, [desde, hasta, ...areaParams]);

    // Día de la semana con más demanda (1=lunes ... 7=domingo en MySQL DAYOFWEEK es 1=dom)
    // Usamos WEEKDAY(): 0=lunes, 1=martes, ..., 6=domingo
    const [porDia] = await pool.query(`
      SELECT WEEKDAY(t.fecha) AS dia_semana, COUNT(*) AS cantidad
      FROM turnos t
      JOIN servicios s ON t.servicio_id = s.id
      WHERE t.fecha BETWEEN ? AND ?
        AND t.estado != 'cancelado'
        ${areaFiltro}
      GROUP BY dia_semana
      ORDER BY dia_semana ASC
    `, [desde, hasta, ...areaParams]);

    // Evolución semanal: turnos agendados (no cancelados) agrupados por semana ISO
    const [evolucionSemanal] = await pool.query(`
      SELECT
        YEARWEEK(t.fecha, 1) AS semana_iso,
        MIN(t.fecha)         AS inicio_semana,
        COUNT(*)             AS cantidad
      FROM turnos t
      JOIN servicios s ON t.servicio_id = s.id
      WHERE t.fecha BETWEEN ? AND ?
        AND t.estado != 'cancelado'
        ${areaFiltro}
      GROUP BY semana_iso
      ORDER BY semana_iso ASC
    `, [desde, hasta, ...areaParams]);

    // Tasa de ausentismo: ausentes / (presentes + ausentes + atendidos) × 100
    const estados = {};
    porEstado.forEach(r => { estados[r.estado] = Number(r.cantidad); });
    const presentes  = estados.presente  || 0;
    const ausentes   = estados.ausente   || 0;
    const atendidos  = estados.atendido  || 0;
    const denominador = presentes + ausentes + atendidos;
    const tasaAusentismo = denominador > 0
      ? ((ausentes / denominador) * 100).toFixed(1)
      : '0.0';

    res.json({
      porEstado,
      porCanal,
      porOperador:    porOperadorFinal,
      porDia,
      evolucionSemanal,
      tasaAusentismo,
    });

  } catch (err) {
    logger.error('[panel] Error al obtener estadísticas:', err);
    res.status(500).json({ error: 'No se pudieron obtener las estadísticas.' });
  }
});


// =============================================================================
// N3 — ABM DE USUARIOS
// =============================================================================

// GET /panel/usuarios — lista usuarios del área (sistemas ve todos)
router.get('/usuarios', async (req, res) => {
  if (!esEncargadoOSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol encargado o sistemas.' });
  }

  try {
    let rows;

    if (esSistemas(req)) {
      // Sistemas ve todos los usuarios con todas sus áreas y roles
      [rows] = await pool.query(`
        SELECT
          u.id, u.nombre, u.usuario, u.activo, u.ultimo_acceso, u.created_at,
          JSON_ARRAYAGG(
            JSON_OBJECT('area_id', ua.area_id, 'area_nombre', a.nombre,
                        'rol', ua.rol, 'atiende_turnos', ua.atiende_turnos)
          ) AS areas_json
        FROM usuarios u
        LEFT JOIN usuario_areas ua ON u.id = ua.usuario_id
        LEFT JOIN areas          a  ON ua.area_id = a.id
        GROUP BY u.id
        ORDER BY u.nombre ASC
      `);
    } else {
      // Encargado ve solo los usuarios de sus propias áreas
      const { areaIds } = req.usuario;
      const ph = areaIds.map(() => '?').join(',');
      [rows] = await pool.query(`
        SELECT
          u.id, u.nombre, u.usuario, u.activo, u.ultimo_acceso, u.created_at,
          JSON_ARRAYAGG(
            JSON_OBJECT('area_id', ua.area_id, 'area_nombre', a.nombre,
                        'rol', ua.rol, 'atiende_turnos', ua.atiende_turnos)
          ) AS areas_json
        FROM usuarios u
        JOIN usuario_areas ua ON u.id = ua.usuario_id
        JOIN areas          a  ON ua.area_id = a.id
        WHERE ua.area_id IN (${ph})
        GROUP BY u.id
        ORDER BY u.nombre ASC
      `, areaIds);
    }

    // Parsear areas_json y determinar el rol efectivo de cada usuario
    const usuarios = rows.map(u => {
      let areas = u.areas_json;
      if (typeof areas === 'string') areas = JSON.parse(areas);
      areas = (areas || []).filter(a => a && a.area_id !== null);
      const rolEfectivo = areas.some(a => a.rol === 'sistemas')  ? 'sistemas'
                        : areas.some(a => a.rol === 'encargado') ? 'encargado'
                        : areas.some(a => a.rol === 'directivo') ? 'directivo'
                        : areas.length > 0 ? 'operador'
                        : null;
      return { id: u.id, nombre: u.nombre, usuario: u.usuario, activo: u.activo,
               ultimo_acceso: u.ultimo_acceso, created_at: u.created_at,
               rol: rolEfectivo, areas };
    });

    res.json(usuarios);
  } catch (err) {
    logger.error('[panel] Error al obtener usuarios:', err);
    res.status(500).json({ error: 'No se pudo obtener la lista de usuarios.' });
  }
});


// POST /panel/usuarios — crear usuario nuevo
// B2: acepta `areas` como array de IDs (en lugar de area_id único) y un rol para todas.
// B3: por cada área, setea atiende_turnos = TRUE para operadores, FALSE para encargados.
// El encargado solo puede asignarlo a sus propias áreas y con rol <= encargado.
// Sistemas puede asignar cualquier área y rol.
router.post('/usuarios', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);
  if (!esEncargadoOSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol encargado o sistemas.' });
  }

  const { nombre, usuario, password, rol } = req.body;
  // areas puede ser un array de IDs o area_id legado (un solo ID) para retro-compatibilidad
  const areas = req.body.areas
    ? [].concat(req.body.areas).map(Number).filter(Boolean)
    : (req.body.area_id ? [parseInt(req.body.area_id, 10)] : []);

  // Directivo no necesita áreas (acceso de solo lectura a todo el sistema)
  const requiereAreas = rol !== 'directivo';
  if (!nombre || !usuario || !password || (requiereAreas && !areas.length) || !rol) {
    return res.status(400).json({
      error: 'Faltan datos: nombre, usuario, password y rol son obligatorios. Las áreas son obligatorias salvo para el rol directivo.'
    });
  }

  const usuarioLimpio = usuario.trim().toLowerCase();
  if (!esUsuarioValido(usuarioLimpio)) {
    return res.status(400).json({
      error: 'Usuario inválido: debe tener 3-50 caracteres, solo minúsculas/números/punto/guion bajo, y no puede empezar con punto ni guion bajo.'
    });
  }

  const rolesValidos = ['operador', 'encargado', 'sistemas', 'directivo'];
  if (!rolesValidos.includes(rol)) {
    return res.status(400).json({ error: `Rol inválido. Valores permitidos: ${rolesValidos.join(', ')}.` });
  }

  if (!esSistemas(req)) {
    if (rol === 'sistemas') {
      return res.status(403).json({ error: 'Solo el rol sistemas puede crear usuarios con rol sistemas.' });
    }
    for (const aId of areas) {
      if (!tieneAccesoAlArea(req, aId)) {
        return res.status(403).json({ error: `Sin permiso para crear usuarios en el área ${aId}.` });
      }
    }
  }

  // Operadores atienden turnos; encargados/directivos/sistemas no
  const atiendeT = rol === 'operador' ? 1 : 0;

  try {
    const [existe] = await pool.query('SELECT id FROM usuarios WHERE usuario = ?', [usuarioLimpio]);
    if (existe.length > 0) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // debe_cambiar_clave=1 porque toda clave creada desde el panel es temporal:
      // el usuario deberá cambiarla en su primer acceso.
      const [result] = await conn.query(
        'INSERT INTO usuarios (nombre, usuario, password_hash, debe_cambiar_clave) VALUES (?, ?, ?, 1)',
        [nombre.trim(), usuarioLimpio, hash]
      );
      const nuevoId = result.insertId;

      if (rol === 'directivo') {
        // El directivo tiene acceso de solo lectura a todo el sistema.
        // Asignamos todas las áreas activas para que el rol quede almacenado
        // en usuario_areas y el login pueda detectarlo correctamente.
        const [todasAreas] = await conn.query('SELECT id FROM areas WHERE activo = TRUE');
        for (const area of todasAreas) {
          await conn.query(
            'INSERT INTO usuario_areas (usuario_id, area_id, rol, atiende_turnos) VALUES (?, ?, ?, 0)',
            [nuevoId, area.id, 'directivo']
          );
        }
      } else {
        for (const aId of areas) {
          await conn.query(
            'INSERT INTO usuario_areas (usuario_id, area_id, rol, atiende_turnos) VALUES (?, ?, ?, ?)',
            [nuevoId, aId, rol, atiendeT]
          );
        }
      }

      await conn.query(
        `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal, ip)
         VALUES (?, 'usuario', ?, 'crear', ?, 'panel', ?)`,
        [req.usuario.id, nuevoId,
         JSON.stringify({ nombre, usuario: usuarioLimpio, rol, areas, atiende_turnos: !!atiendeT, creado_por: req.usuario.nombre }),
         req.ip || null]
      );

      await conn.commit();
      logger.info(`[panel] Usuario ${nuevoId} (${usuarioLimpio}) creado por ${req.usuario.nombre}`);
      res.status(201).json({ ok: true, id: nuevoId });
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
  } catch (err) {
    logger.error('[panel] Error al crear usuario:', err);
    res.status(500).json({ error: 'No se pudo crear el usuario.' });
  }
});


// PATCH /panel/usuarios/:id — editar nombre, rol, estado y áreas del usuario
// B2: acepta `areas` como array de IDs con `atiende_turnos` por área.
//     Si se envía `areas`, compara con las actuales y hace INSERT/DELETE necesarios.
// B3: `atiendeAreas` es un array de { area_id, atiende_turnos } para setear por área.
// El encargado no puede modificar usuarios de otras áreas ni usuarios con rol sistemas.
// Sistemas puede modificar cualquier usuario.
router.patch('/usuarios/:id', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);
  if (!esEncargadoOSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol encargado o sistemas.' });
  }

  const id = parseInt(req.params.id, 10);
  const { nombre, rol, activo, atiendeAreas } = req.body;

  // areas: array de IDs de las áreas nuevas (reemplaza las actuales)
  const areasNuevas = req.body.areas
    ? [].concat(req.body.areas).map(Number).filter(Boolean)
    : null; // null = no se quiere cambiar las áreas

  if (nombre === undefined && rol === undefined && activo === undefined &&
      areasNuevas === null && atiendeAreas === undefined) {
    return res.status(400).json({ error: 'Se requiere al menos uno de: nombre, rol, activo, areas.' });
  }

  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.nombre, u.activo,
             MAX(ua.rol) AS rol_actual
      FROM   usuarios u
      LEFT JOIN usuario_areas ua ON u.id = ua.usuario_id
      WHERE  u.id = ?
      GROUP BY u.id
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const target = rows[0];

    if (!esSistemas(req) && target.rol_actual === 'sistemas') {
      return res.status(403).json({ error: 'No podés modificar un usuario con rol sistemas.' });
    }

    if (!esSistemas(req)) {
      const [enArea] = await pool.query(`
        SELECT ua.usuario_id FROM usuario_areas ua
        WHERE ua.usuario_id = ?
          AND ua.area_id IN (${req.usuario.areaIds.map(() => '?').join(',')})
        LIMIT 1
      `, [id, ...req.usuario.areaIds]);
      if (enArea.length === 0) {
        return res.status(403).json({ error: 'Sin permiso para modificar ese usuario.' });
      }
    }

    if (rol !== undefined) {
      const rolesValidos = ['operador', 'encargado', 'sistemas', 'directivo'];
      if (!rolesValidos.includes(rol)) {
        return res.status(400).json({ error: `Rol inválido. Valores permitidos: ${rolesValidos.join(', ')}.` });
      }
      if (!esSistemas(req) && rol === 'sistemas') {
        return res.status(403).json({ error: 'Solo el rol sistemas puede asignar rol sistemas.' });
      }
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (nombre !== undefined || activo !== undefined) {
        const sets = [], valores = [];
        if (nombre !== undefined) { sets.push('nombre = ?'); valores.push(nombre.trim()); }
        if (activo !== undefined) { sets.push('activo = ?'); valores.push(activo ? 1 : 0); }
        valores.push(id);
        await conn.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`, valores);
      }

      if (rol !== undefined) {
        if (rol === 'directivo') {
          // Al asignar rol directivo, se requiere acceso a todas las áreas.
          // Borramos las asignaciones actuales y re-insertamos con todas las áreas activas.
          const [todasAreas] = await conn.query('SELECT id FROM areas WHERE activo = TRUE');
          await conn.query('DELETE FROM usuario_areas WHERE usuario_id = ?', [id]);
          for (const area of todasAreas) {
            await conn.query(
              'INSERT INTO usuario_areas (usuario_id, area_id, rol, atiende_turnos) VALUES (?, ?, ?, 0)',
              [id, area.id, 'directivo']
            );
          }
        } else {
          await conn.query('UPDATE usuario_areas SET rol = ? WHERE usuario_id = ?', [rol, id]);
        }
      }

      // B2: actualizar áreas si se envió el array (comparar e insertar/borrar)
      if (areasNuevas !== null) {
        const [areasActuales] = await conn.query(
          'SELECT area_id FROM usuario_areas WHERE usuario_id = ?', [id]
        );
        const idsActuales = areasActuales.map(r => r.area_id);
        const idsNuevos   = areasNuevas;

        const agregar  = idsNuevos.filter(a => !idsActuales.includes(a));
        const eliminar = idsActuales.filter(a => !idsNuevos.includes(a));

        if (!esSistemas(req)) {
          for (const aId of [...agregar, ...eliminar]) {
            if (!tieneAccesoAlArea(req, aId)) {
              await conn.rollback();
              return res.status(403).json({ error: `Sin permiso para el área ${aId}.` });
            }
          }
        }

        const rolFinal   = rol ?? target.rol_actual ?? 'operador';
        const atiendeT   = rolFinal === 'operador' ? 1 : 0;

        for (const aId of agregar) {
          await conn.query(
            'INSERT INTO usuario_areas (usuario_id, area_id, rol, atiende_turnos) VALUES (?, ?, ?, ?)',
            [id, aId, rolFinal, atiendeT]
          );
        }
        if (eliminar.length > 0) {
          await conn.query(
            `DELETE FROM usuario_areas WHERE usuario_id = ? AND area_id IN (${eliminar.map(() => '?').join(',')})`,
            [id, ...eliminar]
          );
        }
      }

      // B3: actualizar atiende_turnos por área si se envió atiendeAreas
      // atiendeAreas = [{ area_id, atiende_turnos }, ...]
      if (Array.isArray(atiendeAreas)) {
        for (const { area_id, atiende_turnos } of atiendeAreas) {
          await conn.query(
            'UPDATE usuario_areas SET atiende_turnos = ? WHERE usuario_id = ? AND area_id = ?',
            [atiende_turnos ? 1 : 0, id, area_id]
          );
        }
      }

      await conn.query(
        `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal, ip)
         VALUES (?, 'usuario', ?, 'modificar', ?, 'panel', ?)`,
        [req.usuario.id, id,
         JSON.stringify({ nombre, rol, activo, areas: areasNuevas, modificado_por: req.usuario.nombre }),
         req.ip || null]
      );

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error('[panel] Error al editar usuario:', err);
    res.status(500).json({ error: 'No se pudo modificar el usuario.' });
  }
});


// =============================================================================
// N4 — ABM DE SERVICIOS
// =============================================================================

// GET /panel/servicios/admin — lista servicios con todos los campos (para el ABM)
// IMPORTANTE: esta ruta DEBE ir ANTES de GET /servicios/:id/mensaje para que Express
// no interprete "admin" como un ID numérico. En el código actual ya está ordenado
// correctamente porque este endpoint se agrega al final del archivo.
router.get('/servicios/admin', async (req, res) => {
  if (!esEncargadoOSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol encargado o sistemas.' });
  }

  try {
    let query;
    let params = [];

    // turnos_activos: turnos agendados a futuro de este servicio — misma
    // definición que el chequeo anti-duplicado de routes/publico.js y
    // routes/panel.js (crearCita), para que "activo" signifique lo mismo
    // en todo el sistema. Se usa en servicios-admin.html para el aviso
    // condicional al desactivar un servicio.
    const turnosActivosSubquery = `(
      SELECT COUNT(*) FROM turnos t
      WHERE t.servicio_id = s.id
        AND t.estado = 'agendado'
        AND (t.fecha > CURDATE() OR (t.fecha = CURDATE() AND t.hora_inicio > CURTIME()))
    ) AS turnos_activos`;

    if (esSistemas(req)) {
      query = `
        SELECT s.id, s.nombre, s.duracion_min, s.max_dias_anticipacion,
               s.mensaje_confirmacion, s.activo, s.created_at,
               a.id AS area_id, a.nombre AS area_nombre,
               ${turnosActivosSubquery}
        FROM servicios s
        JOIN areas a ON s.area_id = a.id
        ORDER BY a.nombre ASC, s.nombre ASC
      `;
    } else {
      const { areaIds } = req.usuario;
      const ph = areaIds.map(() => '?').join(',');
      query = `
        SELECT s.id, s.nombre, s.duracion_min, s.max_dias_anticipacion,
               s.mensaje_confirmacion, s.activo, s.created_at,
               a.id AS area_id, a.nombre AS area_nombre,
               ${turnosActivosSubquery}
        FROM servicios s
        JOIN areas a ON s.area_id = a.id
        WHERE s.area_id IN (${ph})
        ORDER BY a.nombre ASC, s.nombre ASC
      `;
      params = areaIds;
    }

    const [servicios] = await pool.query(query, params);
    res.json(servicios);
  } catch (err) {
    logger.error('[panel] Error al obtener servicios (admin):', err);
    res.status(500).json({ error: 'No se pudo obtener la lista de servicios.' });
  }
});


// POST /panel/servicios — crear servicio nuevo
router.post('/servicios', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);
  if (!esEncargadoOSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol encargado o sistemas.' });
  }

  const { nombre, area_id, duracion_min, max_dias_anticipacion, mensaje_confirmacion } = req.body;

  if (!nombre || !area_id || !duracion_min) {
    return res.status(400).json({
      error: 'Faltan datos: nombre, area_id y duracion_min son obligatorios.'
    });
  }

  const areaIdNum     = parseInt(area_id, 10);
  const duracionNum   = parseInt(duracion_min, 10);
  const anticipacion  = parseInt(max_dias_anticipacion, 10) || 30;

  if (!tieneAccesoAlArea(req, areaIdNum)) {
    return res.status(403).json({ error: 'Sin permiso para crear servicios en esa área.' });
  }

  if (duracionNum < 5 || duracionNum > 240) {
    return res.status(400).json({ error: 'La duración debe estar entre 5 y 240 minutos.' });
  }

  try {
    const [result] = await pool.query(`
      INSERT INTO servicios (nombre, area_id, duracion_min, max_dias_anticipacion, mensaje_confirmacion)
      VALUES (?, ?, ?, ?, ?)
    `, [
      nombre.trim(), areaIdNum, duracionNum, anticipacion,
      mensaje_confirmacion?.trim() || null,
    ]);

    await auditar(req.usuario.id, 'servicio', result.insertId, 'crear',
      { nombre, area_id: areaIdNum, duracion_min: duracionNum, creado_por: req.usuario.nombre }, req.ip);

    logger.info(`[panel] Servicio ${result.insertId} (${nombre}) creado por ${req.usuario.nombre}`);
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    logger.error('[panel] Error al crear servicio:', err);
    res.status(500).json({ error: 'No se pudo crear el servicio.' });
  }
});


// PATCH /panel/servicios/:id — editar cualquier campo del servicio (incluyendo activar/desactivar)
router.patch('/servicios/:id', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);
  if (!esEncargadoOSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol encargado o sistemas.' });
  }

  const id = parseInt(req.params.id, 10);
  const { nombre, duracion_min, max_dias_anticipacion, mensaje_confirmacion, activo } = req.body;

  if (nombre === undefined && duracion_min === undefined &&
      max_dias_anticipacion === undefined && mensaje_confirmacion === undefined && activo === undefined) {
    return res.status(400).json({ error: 'Se requiere al menos un campo para actualizar.' });
  }

  try {
    const [rows] = await pool.query('SELECT id, area_id FROM servicios WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Servicio no encontrado.' });
    }

    if (!tieneAccesoAlArea(req, rows[0].area_id)) {
      return res.status(403).json({ error: 'Sin permiso para modificar ese servicio.' });
    }

    const sets    = [];
    const valores = [];
    if (nombre !== undefined)               { sets.push('nombre = ?');                valores.push(nombre.trim()); }
    if (duracion_min !== undefined)         { sets.push('duracion_min = ?');          valores.push(parseInt(duracion_min, 10)); }
    if (max_dias_anticipacion !== undefined){ sets.push('max_dias_anticipacion = ?'); valores.push(parseInt(max_dias_anticipacion, 10)); }
    if (mensaje_confirmacion !== undefined) { sets.push('mensaje_confirmacion = ?');  valores.push(mensaje_confirmacion.trim() || null); }
    if (activo !== undefined)               { sets.push('activo = ?');                valores.push(activo ? 1 : 0); }
    valores.push(id);

    await pool.query(`UPDATE servicios SET ${sets.join(', ')} WHERE id = ?`, valores);

    await auditar(req.usuario.id, 'servicio', id, 'modificar',
      { nombre, duracion_min, max_dias_anticipacion, mensaje_confirmacion, activo, modificado_por: req.usuario.nombre },
      req.ip);

    res.json({ ok: true });
  } catch (err) {
    logger.error('[panel] Error al editar servicio:', err);
    res.status(500).json({ error: 'No se pudo modificar el servicio.' });
  }
});


// =============================================================================
// B4 — HORARIOS DE USUARIO
// =============================================================================

// GET /panel/usuarios/:id/horarios
// Devuelve todos los horarios configurados para el usuario.
// Incluye el nombre del servicio para que el frontend los pueda mostrar sin otra consulta.
router.get('/usuarios/:id/horarios', async (req, res) => {
  if (!esEncargadoOSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol encargado o sistemas.' });
  }

  const id = parseInt(req.params.id, 10);

  // Verificar acceso: el encargado solo puede ver horarios de usuarios de sus áreas
  if (!esSistemas(req)) {
    const [enArea] = await pool.query(`
      SELECT 1 FROM usuario_areas ua
      WHERE ua.usuario_id = ?
        AND ua.area_id IN (${req.usuario.areaIds.map(() => '?').join(',')})
      LIMIT 1
    `, [id, ...req.usuario.areaIds]);
    if (enArea.length === 0) {
      return res.status(403).json({ error: 'Sin permiso para ver los horarios de ese usuario.' });
    }
  }

  try {
    const [horarios] = await pool.query(`
      SELECT h.id, h.servicio_id, s.nombre AS servicio_nombre,
             h.dia_semana, h.hora_inicio, h.hora_fin, h.activo
      FROM horarios h
      JOIN servicios s ON s.id = h.servicio_id
      WHERE h.usuario_id = ?
      ORDER BY h.servicio_id ASC, h.dia_semana ASC
    `, [id]);

    res.json(horarios);
  } catch (err) {
    logger.error('[panel] Error al obtener horarios de usuario:', err);
    res.status(500).json({ error: 'No se pudieron obtener los horarios.' });
  }
});


// PUT /panel/usuarios/:id/horarios
// Reemplaza TODOS los horarios del usuario con los que se envíen.
// Estrategia: DELETE todos los actuales + INSERT los nuevos en una transacción.
// Body: { horarios: [{ servicio_id, dia_semana, hora_inicio, hora_fin, activo }] }
router.put('/usuarios/:id/horarios', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);
  if (!esEncargadoOSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol encargado o sistemas.' });
  }

  const id = parseInt(req.params.id, 10);
  const { horarios } = req.body;

  if (!Array.isArray(horarios)) {
    return res.status(400).json({ error: 'El campo horarios debe ser un array.' });
  }

  // Validación básica de cada item
  for (const h of horarios) {
    if (!h.servicio_id || !h.dia_semana || !h.hora_inicio || !h.hora_fin) {
      return res.status(400).json({
        error: 'Cada horario requiere: servicio_id, dia_semana, hora_inicio, hora_fin.'
      });
    }
  }

  if (!esSistemas(req)) {
    const [enArea] = await pool.query(`
      SELECT 1 FROM usuario_areas ua
      WHERE ua.usuario_id = ?
        AND ua.area_id IN (${req.usuario.areaIds.map(() => '?').join(',')})
      LIMIT 1
    `, [id, ...req.usuario.areaIds]);
    if (enArea.length === 0) {
      return res.status(403).json({ error: 'Sin permiso para modificar los horarios de ese usuario.' });
    }
  }

  try {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Borrar todos los horarios actuales del usuario
      await conn.query('DELETE FROM horarios WHERE usuario_id = ?', [id]);

      // Insertar los nuevos
      for (const h of horarios) {
        await conn.query(
          `INSERT INTO horarios (usuario_id, servicio_id, dia_semana, hora_inicio, hora_fin, activo)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, h.servicio_id, h.dia_semana, h.hora_inicio, h.hora_fin,
           h.activo !== false ? 1 : 0]
        );
      }

      await conn.query(
        `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal, ip)
         VALUES (?, 'horario', ?, 'modificar', ?, 'panel', ?)`,
        [req.usuario.id, id,
         JSON.stringify({ cantidad: horarios.length, modificado_por: req.usuario.nombre }),
         req.ip || null]
      );

      await conn.commit();
      logger.info(`[panel] Horarios de usuario ${id} actualizados por ${req.usuario.nombre}`);
      res.json({ ok: true, cantidad: horarios.length });
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
  } catch (err) {
    logger.error('[panel] Error al guardar horarios de usuario:', err);
    res.status(500).json({ error: 'No se pudieron guardar los horarios.' });
  }
});


// =============================================================================
// RESETEO DE CONTRASEÑA (solo sistemas)
// =============================================================================

// POST /panel/usuarios/:id/resetear-clave
// Genera una contraseña temporal de 8 caracteres, la guarda hasheada y activa
// debe_cambiar_clave=TRUE para que el usuario sea obligado a cambiarla al próximo login.
// Solo accesible por el rol sistemas.
// Devuelve la contraseña en texto plano para que sistemas se la comunique al usuario.
router.post('/usuarios/:id/resetear-clave', async (req, res) => {
  if (!esSistemas(req)) {
    return res.status(403).json({ error: 'Solo el rol sistemas puede resetear contraseñas.' });
  }

  const id = parseInt(req.params.id, 10);

  try {
    const [rows] = await pool.query('SELECT id, nombre, usuario FROM usuarios WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    // Generar contraseña temporal de 8 caracteres (letras + números, fácil de comunicar)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let claveTemporal = '';
    for (let i = 0; i < 8; i++) {
      claveTemporal += chars[Math.floor(Math.random() * chars.length)];
    }

    const hash = await bcrypt.hash(claveTemporal, 10);

    await pool.query(
      'UPDATE usuarios SET password_hash = ?, debe_cambiar_clave = TRUE WHERE id = ?',
      [hash, id]
    );

    await auditar(req.usuario.id, 'usuario', id, 'modificar', {
      accion_detalle: 'reseteo de contraseña',
      reseteado_por: req.usuario.nombre,
      usuario_afectado: rows[0].nombre,
    }, req.ip);

    logger.info(`[panel] Contraseña de usuario ${id} (${rows[0].usuario}) reseteada por ${req.usuario.nombre}`);
    res.json({ ok: true, clave_temporal: claveTemporal });

  } catch (err) {
    logger.error('[panel] Error al resetear contraseña:', err);
    res.status(500).json({ error: 'No se pudo resetear la contraseña.' });
  }
});


// =============================================================================
// B9 — ENDPOINT AUXILIAR: áreas disponibles para selector
// =============================================================================

// GET /panel/areas
// Devuelve las áreas accesibles por el usuario.
// Sistemas y directivo devuelven TODAS las áreas activas.
// Encargado y operador devuelven solo sus áreas.
router.get('/areas', async (req, res) => {
  try {
    let areas;
    if (esSistemas(req) || esDirectivo(req)) {
      const [rows] = await pool.query(
        'SELECT id, nombre FROM areas WHERE activo = TRUE ORDER BY nombre ASC'
      );
      areas = rows;
    } else {
      const { areaIds } = req.usuario;
      if (!areaIds.length) return res.json([]);
      const [rows] = await pool.query(
        `SELECT id, nombre FROM areas WHERE id IN (${areaIds.map(() => '?').join(',')}) AND activo = TRUE ORDER BY nombre ASC`,
        areaIds
      );
      areas = rows;
    }
    res.json(areas);
  } catch (err) {
    logger.error('[panel] Error al obtener áreas:', err);
    res.status(500).json({ error: 'No se pudieron obtener las áreas.' });
  }
});


// =============================================================================
// N5 — ABM DE ÁREAS (exclusivo rol sistemas)
// =============================================================================

// GET /panel/areas/admin — lista TODAS las áreas (activas e inactivas) con
// conteos de servicios activos y usuarios asignados, para el ABM.
// Distinto del GET /panel/areas de arriba (usado por los chips B9 de otras
// pantallas): ese solo devuelve {id, nombre} de áreas activas y no se toca.
router.get('/areas/admin', async (req, res) => {
  if (!esSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol sistemas.' });
  }

  try {
    const [areas] = await pool.query(`
      SELECT
        a.id, a.nombre, a.descripcion, a.activo, a.created_at,
        (SELECT COUNT(*) FROM servicios s WHERE s.area_id = a.id AND s.activo = TRUE) AS servicios_activos,
        (SELECT COUNT(*) FROM usuario_areas ua WHERE ua.area_id = a.id) AS usuarios_asignados
      FROM areas a
      ORDER BY a.nombre ASC
    `);
    res.json(areas);
  } catch (err) {
    logger.error('[panel] Error al obtener áreas (admin):', err);
    res.status(500).json({ error: 'No se pudieron obtener las áreas.' });
  }
});


// POST /panel/areas — crear área nueva
router.post('/areas', async (req, res) => {
  if (!esSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol sistemas.' });
  }

  const { nombre, descripcion } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre es obligatorio.' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO areas (nombre, descripcion) VALUES (?, ?)',
      [nombre.trim(), descripcion?.trim() || null]
    );

    await auditar(req.usuario.id, 'area', result.insertId, 'crear',
      { nombre, descripcion, creado_por: req.usuario.nombre }, req.ip);

    logger.info(`[panel] Área ${result.insertId} (${nombre}) creada por ${req.usuario.nombre}`);
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    logger.error('[panel] Error al crear área:', err);
    res.status(500).json({ error: 'No se pudo crear el área.' });
  }
});


// PATCH /panel/areas/:id — editar nombre, descripción y/o estado activo/inactivo
router.patch('/areas/:id', async (req, res) => {
  if (!esSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol sistemas.' });
  }

  const id = parseInt(req.params.id, 10);
  const { nombre, descripcion, activo } = req.body;

  if (nombre === undefined && descripcion === undefined && activo === undefined) {
    return res.status(400).json({ error: 'Se requiere al menos un campo para actualizar.' });
  }

  try {
    const [rows] = await pool.query('SELECT id FROM areas WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Área no encontrada.' });
    }

    const sets    = [];
    const valores = [];
    if (nombre !== undefined)      { sets.push('nombre = ?');      valores.push(nombre.trim()); }
    if (descripcion !== undefined) { sets.push('descripcion = ?'); valores.push(descripcion?.trim() || null); }
    if (activo !== undefined)      { sets.push('activo = ?');      valores.push(activo ? 1 : 0); }
    valores.push(id);

    await pool.query(`UPDATE areas SET ${sets.join(', ')} WHERE id = ?`, valores);

    await auditar(req.usuario.id, 'area', id, 'modificar',
      { nombre, descripcion, activo, modificado_por: req.usuario.nombre }, req.ip);

    res.json({ ok: true });
  } catch (err) {
    logger.error('[panel] Error al editar área:', err);
    res.status(500).json({ error: 'No se pudo modificar el área.' });
  }
});


module.exports = router;
