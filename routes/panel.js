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
    const { areaIds } = req.usuario;

    const condiciones = ['t.fecha >= ?', 't.fecha <= ?', "t.estado != 'cancelado'"];
    const params      = [desde, hasta];

    if (areaIds.length > 0) {
      condiciones.push(`s.area_id IN (${areaIds.map(() => '?').join(',')})`);
      params.push(...areaIds);
    }

    // Operador: solo sus propios turnos.
    // Encargado, directivo y sistemas: todos los del área, con filtro opcional por operador.
    if (req.usuario.rol === 'operador') {
      condiciones.push('t.operador_id = ?');
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
    const { areaIds } = req.usuario;

    // Construir los filtros de forma dinámica para no tener queries duplicadas
    const condiciones = ['t.fecha = ?', "t.estado != 'cancelado'"];
    const params      = [fecha];

    // Limitar a las áreas del usuario (siempre aplica para todos los roles)
    if (areaIds.length > 0) {
      condiciones.push(`s.area_id IN (${areaIds.map(() => '?').join(',')})`);
      params.push(...areaIds);
    }

    // Operador → solo sus propios turnos (incluye turnos sin operador asignado aún)
    // Encargado, directivo y sistemas → todos los del área, con filtro opcional por operador
    if (req.usuario.rol === 'operador') {
      condiciones.push('t.operador_id = ?');
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

    const { areaIds } = req.usuario;
    let bloqueados           = [];
    const bloqueosIndividuales = {}; // { "YYYY-MM-DD": ["Sofía García", ...] }

    if (areaIds.length > 0) {
      const ph = areaIds.map(() => '?').join(','); // placeholders para areaIds

      // ── Bloqueos de OFICINA de día completo ──────────────────────────────
      // Solo mostramos las áreas del usuario: un operador de Licencias no ve
      // los bloqueos de Tribunal de Faltas, que no le afectan.
      const [bloqueoOficina] = await pool.query(`
        SELECT fecha_inicio, fecha_fin
        FROM bloqueos
        WHERE tipo        = 'oficina'
          AND hora_inicio IS NULL
          AND area_id     IN (${ph})
          AND fecha_inicio <= ?
          AND fecha_fin    >= ?
      `, [...areaIds, hasta, desde]);

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
      //   Operador regular     → solo sus propios bloqueos
      //   Encargado sin filtro → todos los operadores de sus áreas
      //   Encargado con filtro → solo ese operador específico
      const condInd = [
        "b.tipo        = 'individual'",
        'b.hora_inicio IS NULL',
        `b.area_id     IN (${ph})`,
        'b.fecha_inicio <= ?',
        'b.fecha_fin    >= ?',
      ];
      const paramsInd = [...areaIds, hasta, desde];

      if (!esEncargado(req)) {
        // Operador: solo puede ver sus propios bloqueos
        condInd.push('b.usuario_id = ?');
        paramsInd.push(req.usuario.id);
      } else if (operadorIdFiltro) {
        // Encargado con un operador específico seleccionado en el dropdown
        condInd.push('b.usuario_id = ?');
        paramsInd.push(operadorIdFiltro);
      }
      // Encargado sin filtro → no se agrega condición de usuario_id → devuelve todos

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

    if (!esEncargado(req) && turno.operador_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Solo podés cancelar tus propios turnos.' });
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
  const areaId = req.query.areaId ? parseInt(req.query.areaId, 10) : null;
  const hoy    = new Date().toISOString().substring(0, 10);

  try {
    const { areaIds } = req.usuario;

    if (areaId && !tieneAccesoAlArea(req, areaId)) {
      return res.status(403).json({ error: 'Sin acceso a esa área.' });
    }

    // Si se especificó areaId, filtrar solo esa; si no, todas las del usuario
    const filtroAreas = areaId ? [areaId] : areaIds;

    const condiciones = [
      `b.area_id IN (${filtroAreas.map(() => '?').join(',')})`,
      'b.fecha_fin >= ?',
    ];
    const params = [...filtroAreas, hoy];

    // Operador solo ve sus propios bloqueos individuales y los de oficina de su área
    if (!esEncargado(req)) {
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

  if (!esEncargado(req)) {
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

    if (!esEncargado(req)) {
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

// GET /panel/operadores
// Lista los operadores de las áreas del usuario.
// El encargado lo usa para el filtro de agenda por operador.
router.get('/operadores', async (req, res) => {
  const { areaIds } = req.usuario;

  try {
    const [operadores] = await pool.query(`
      SELECT DISTINCT u.id, u.nombre
      FROM   usuarios u
      JOIN   usuario_areas ua ON u.id = ua.usuario_id
      WHERE  ua.area_id IN (${areaIds.map(() => '?').join(',')})
        AND  u.activo = TRUE
      ORDER BY u.nombre ASC
    `, areaIds);

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
  const { areaIds } = req.usuario;

  try {
    const [servicios] = await pool.query(`
      SELECT id, nombre, duracion_min AS duration, area_id
      FROM   servicios
      WHERE  area_id IN (${areaIds.map(() => '?').join(',')})
        AND  activo = TRUE
      ORDER BY nombre ASC
    `, areaIds);

    res.json(servicios);
  } catch (err) {
    logger.error('[panel] Error al obtener servicios del panel:', err);
    res.status(500).json({ error: 'No se pudieron obtener los servicios.' });
  }
});


// =============================================================================
// N1 — AUDITORÍA
// =============================================================================

// GET /panel/auditoria?desde=&hasta=&usuarioId=&accion=&entidadTipo=&pagina=
// Devuelve registros de auditoría paginados (50 por página).
// Encargado: solo ve registros de acciones de usuarios de sus áreas.
// Sistemas: ve todos los registros sin filtro de área.
router.get('/auditoria', async (req, res) => {
  if (!esEncargadoOSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol encargado o sistemas.' });
  }

  const { desde, hasta, usuarioId, accion, entidadTipo } = req.query;
  const pagina  = Math.max(1, parseInt(req.query.pagina, 10) || 1);
  const limite  = 50;
  const offset  = (pagina - 1) * limite;

  try {
    const condiciones = [];
    const params      = [];

    // El encargado solo ve acciones de usuarios de sus propias áreas.
    // El rol sistemas ve todo — no se agrega filtro de área.
    if (!esSistemas(req)) {
      const { areaIds } = req.usuario;
      if (areaIds.length > 0) {
        const ph = areaIds.map(() => '?').join(',');
        // Incluir registros de usuarios que trabajan en las áreas del encargado,
        // más los registros del sistema (usuario_id NULL) y los del propio encargado.
        condiciones.push(`(
          a.usuario_id IS NULL
          OR a.usuario_id = ?
          OR a.usuario_id IN (
            SELECT ua.usuario_id FROM usuario_areas ua WHERE ua.area_id IN (${ph})
          )
        )`);
        params.push(req.usuario.id, ...areaIds);
      }
    }

    if (desde)        { condiciones.push('a.timestamp >= ?'); params.push(desde + ' 00:00:00'); }
    if (hasta)        { condiciones.push('a.timestamp <= ?'); params.push(hasta + ' 23:59:59'); }
    if (usuarioId)    { condiciones.push('a.usuario_id = ?'); params.push(parseInt(usuarioId, 10)); }
    if (accion)       { condiciones.push('a.accion = ?');     params.push(accion); }
    if (entidadTipo)  { condiciones.push('a.entidad_tipo = ?'); params.push(entidadTipo); }

    const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';

    // Contar total para la paginación
    const [conteo] = await pool.query(
      `SELECT COUNT(*) AS total FROM auditoria a ${where}`,
      params
    );
    const total = conteo[0].total;

    // Traer la página solicitada
    const [registros] = await pool.query(`
      SELECT
        a.id,
        a.timestamp,
        u.nombre    AS usuario_nombre,
        u.email     AS usuario_email,
        a.accion,
        a.entidad_tipo,
        a.entidad_id,
        a.detalle,
        a.canal,
        a.ip
      FROM auditoria a
      LEFT JOIN usuarios u ON a.usuario_id = u.id
      ${where}
      ORDER BY a.timestamp DESC
      LIMIT ? OFFSET ?
    `, [...params, limite, offset]);

    res.json({
      registros,
      total,
      pagina,
      paginas: Math.ceil(total / limite),
    });

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
      query = 'SELECT id, nombre, email FROM usuarios WHERE activo = TRUE ORDER BY nombre ASC';
    } else {
      const { areaIds } = req.usuario;
      const ph = areaIds.map(() => '?').join(',');
      query = `
        SELECT DISTINCT u.id, u.nombre, u.email
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
    const { areaIds } = req.usuario;

    // El filtro de área solo aplica para encargados — sistemas ve todo
    const areaFiltro = esSistemas(req) ? '' : (areaIds.length > 0
      ? `AND s.area_id IN (${areaIds.map(() => '?').join(',')})`
      : '');
    const areaParams = esSistemas(req) ? [] : areaIds;

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
          u.id, u.nombre, u.email, u.activo, u.ultimo_acceso, u.created_at,
          JSON_ARRAYAGG(
            JSON_OBJECT('area_id', ua.area_id, 'area_nombre', a.nombre, 'rol', ua.rol)
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
          u.id, u.nombre, u.email, u.activo, u.ultimo_acceso, u.created_at,
          JSON_ARRAYAGG(
            JSON_OBJECT('area_id', ua.area_id, 'area_nombre', a.nombre, 'rol', ua.rol)
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
                        : areas.length > 0 ? 'operador'
                        : null;
      return { id: u.id, nombre: u.nombre, email: u.email, activo: u.activo,
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
// El encargado solo puede asignarlo a sus propias áreas y con rol <= encargado.
// Sistemas puede asignar cualquier área y rol.
router.post('/usuarios', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);
  if (!esEncargadoOSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol encargado o sistemas.' });
  }

  const { nombre, email, password, area_id, rol } = req.body;

  if (!nombre || !email || !password || !area_id || !rol) {
    return res.status(400).json({
      error: 'Faltan datos: nombre, email, password, area_id y rol son obligatorios.'
    });
  }

  const rolesValidos = ['operador', 'encargado', 'sistemas', 'directivo'];
  if (!rolesValidos.includes(rol)) {
    return res.status(400).json({ error: `Rol inválido. Valores permitidos: ${rolesValidos.join(', ')}.` });
  }

  // El encargado no puede asignar rol 'sistemas' ni asignar a áreas ajenas
  if (!esSistemas(req)) {
    if (rol === 'sistemas') {
      return res.status(403).json({ error: 'Solo el rol sistemas puede crear usuarios con rol sistemas.' });
    }
    if (!tieneAccesoAlArea(req, area_id)) {
      return res.status(403).json({ error: 'Sin permiso para crear usuarios en esa área.' });
    }
  }

  const areaIdNum = parseInt(area_id, 10);

  try {
    // Verificar que el email no esté en uso
    const [existe] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [email]);
    if (existe.length > 0) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese email.' });
    }

    const hash = await bcrypt.hash(password, 10);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [result] = await conn.query(
        'INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)',
        [nombre.trim(), email.trim().toLowerCase(), hash]
      );
      const nuevoId = result.insertId;

      await conn.query(
        'INSERT INTO usuario_areas (usuario_id, area_id, rol) VALUES (?, ?, ?)',
        [nuevoId, areaIdNum, rol]
      );

      await conn.query(
        `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal, ip)
         VALUES (?, 'usuario', ?, 'crear', ?, 'panel', ?)`,
        [req.usuario.id, nuevoId, JSON.stringify({ nombre, email, rol, area_id: areaIdNum, creado_por: req.usuario.nombre }), req.ip || null]
      );

      await conn.commit();
      logger.info(`[panel] Usuario ${nuevoId} (${email}) creado por ${req.usuario.nombre}`);
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


// PATCH /panel/usuarios/:id — editar nombre, rol o estado (activar/desactivar)
// El encargado no puede modificar usuarios de otras áreas ni usuarios con rol sistemas.
// Sistemas puede modificar cualquier usuario.
router.patch('/usuarios/:id', async (req, res) => {
  if (esDirectivo(req)) return rechazarDirectivo(res);
  if (!esEncargadoOSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol encargado o sistemas.' });
  }

  const id = parseInt(req.params.id, 10);
  const { nombre, rol, activo } = req.body;

  if (nombre === undefined && rol === undefined && activo === undefined) {
    return res.status(400).json({ error: 'Se requiere al menos uno de: nombre, rol, activo.' });
  }

  try {
    // Verificar existencia del usuario y obtener su rol actual
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

    // El encargado no puede modificar usuarios con rol 'sistemas'
    if (!esSistemas(req) && target.rol_actual === 'sistemas') {
      return res.status(403).json({ error: 'No podés modificar un usuario con rol sistemas.' });
    }

    // El encargado solo puede modificar usuarios de sus propias áreas
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

    // Validar rol si se envía
    if (rol !== undefined) {
      const rolesValidos = ['operador', 'encargado', 'sistemas', 'directivo'];
      if (!rolesValidos.includes(rol)) {
        return res.status(400).json({ error: `Rol inválido. Valores permitidos: ${rolesValidos.join(', ')}.` });
      }
      if (!esSistemas(req) && rol === 'sistemas') {
        return res.status(403).json({ error: 'Solo el rol sistemas puede asignar rol sistemas.' });
      }
    }

    // Aplicar cambios
    if (nombre !== undefined || activo !== undefined) {
      const sets    = [];
      const valores = [];
      if (nombre !== undefined) { sets.push('nombre = ?'); valores.push(nombre.trim()); }
      if (activo !== undefined) { sets.push('activo = ?'); valores.push(activo ? 1 : 0); }
      valores.push(id);
      await pool.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`, valores);
    }

    // Actualizar rol en todas las áreas del usuario (usamos UPDATE en usuario_areas)
    if (rol !== undefined) {
      await pool.query('UPDATE usuario_areas SET rol = ? WHERE usuario_id = ?', [rol, id]);
    }

    await auditar(req.usuario.id, 'usuario', id, 'modificar',
      { nombre, rol, activo, modificado_por: req.usuario.nombre }, req.ip);

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

    if (esSistemas(req)) {
      query = `
        SELECT s.id, s.nombre, s.duracion_min, s.max_dias_anticipacion,
               s.mensaje_confirmacion, s.activo, s.created_at,
               a.id AS area_id, a.nombre AS area_nombre
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
               a.id AS area_id, a.nombre AS area_nombre
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


module.exports = router;
