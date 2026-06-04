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
const { verificarJWT } = require('../middleware/auth');

// Todos los endpoints de este router requieren autenticación
router.use(verificarJWT);


// =============================================================================
// HELPERS INTERNOS (no se exportan)
// =============================================================================

// Retorna true si el usuario autenticado tiene rol 'encargado'
function esEncargado(req) {
  return req.usuario.rol === 'encargado';
}

// Retorna true si el areaId dado está entre las áreas del usuario
function tieneAccesoAlArea(req, areaId) {
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
// Devuelve { existe: true, nombre, telefono } o { existe: false }.
router.get('/vecino/:dni', async (req, res) => {
  const { dni } = req.params;

  try {
    const [rows] = await pool.query(
      'SELECT nombre, telefono FROM vecinos WHERE dni = ?',
      [dni]
    );

    if (rows.length === 0) {
      return res.json({ existe: false });
    }

    res.json({
      existe:   true,
      nombre:   rows[0].nombre,
      telefono: rows[0].telefono || '',
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

    if (!esEncargado(req)) {
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
      JOIN usuarios  u ON t.operador_id = u.id
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

    // Operador → solo sus propios turnos
    // Encargado → todos los de sus áreas, con filtro opcional por operador
    if (!esEncargado(req)) {
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
        u.id         AS operador_id,
        u.nombre     AS operador_nombre,
        a.id         AS area_id,
        a.nombre     AS area_nombre
      FROM turnos t
      JOIN vecinos   v ON t.vecino_id   = v.id
      JOIN servicios s ON t.servicio_id = s.id
      JOIN usuarios  u ON t.operador_id = u.id
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
// TURNOS — modificar estado
// =============================================================================

// PATCH /panel/turno/:id/estado
// Cambia el estado del turno: presente, ausente, atendido.
// NO permite cancelar desde acá — la cancelación usa DELETE /panel/turno/:id.
// Registra el estado anterior en auditoría para tener trazabilidad completa.
router.patch('/turno/:id/estado', async (req, res) => {
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
  const { dni, nombre, telefono, serviceId, fecha, horario } = req.body;

  if (!dni || !nombre || !serviceId || !fecha || !horario) {
    return res.status(400).json({
      error: 'Faltan datos. Se requieren: dni, nombre, serviceId, fecha, horario.'
    });
  }

  try {
    const serviceIdNum = parseInt(serviceId, 10);

    // Obtener la disponibilidad para saber qué operador corresponde al slot (round-robin)
    const disponibilidad = await motor.obtenerDisponibilidadServicio(serviceIdNum, fecha);
    const providerId     = disponibilidad.mapaHorarioOperador[horario];

    if (!providerId) {
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

    // Construir fechaHora y fechaHoraFin en formato "YYYY-MM-DD HH:MM:SS"
    const [hh, mm]    = horario.split(':').map(Number);
    const finMinutos  = hh * 60 + mm + servicio.duration;
    const finHH       = String(Math.floor(finMinutos / 60)).padStart(2, '0');
    const finMM       = String(finMinutos % 60).padStart(2, '0');
    const fechaHora   = `${fecha} ${horario}:00`;
    const fechaHoraFin = `${fecha} ${finHH}:${finMM}:00`;

    // crearCita() con canal 'presencial' activa canal_origen='presencial'
    // y registra auditoría con canal='panel' (manejo interno de motor.js)
    const cita = await motor.crearCita({
      dni, nombre, telefono: telefono || null,
      serviceId: serviceIdNum,
      providerId,
      fechaHora,
      fechaHoraFin,
      canal: 'presencial',
    });

    logger.info(
      `[panel] Turno presencial ID ${cita.id} | DNI: ${dni} | por: ${req.usuario.nombre}`
    );
    res.status(201).json(cita);

  } catch (err) {
    logger.error('[panel] Error al crear turno presencial:', err);
    // Errores de negocio (slot ocupado, vecino ya tiene turno) → 409 Conflict
    const esErrorNegocio = err.message?.includes('ya fue reservado') ||
                           err.message?.includes('ya tiene un turno');
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


module.exports = router;
