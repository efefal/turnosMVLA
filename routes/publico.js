// routes/publico.js — Endpoints públicos para el selector web de turnos
//
// Sin autenticación JWT. Son de acceso libre para los vecinos.
// Todas las operaciones usan motor.js (no ea.js ni conexión directa a MySQL).
//
// Montado en index.js como: app.use('/api', require('./routes/publico'))
// Esto hace que estas rutas tomen precedencia sobre los endpoints heredados
// de Easy!Appointments que todavía están en index.js (serán eliminados al corte).

'use strict';

const router = require('express').Router();
const pool   = require('../db');
const motor  = require('../motor');
const logger = require('../logger');


// =============================================================================
// GET /api/vecino/:dni
// Busca si el vecino existe y devuelve sus turnos activos futuros.
//
// El selector web lo llama al ingresar el DNI para decidir si mostrar
// los turnos existentes (con opciones de cancelar/modificar) o avanzar
// directamente al flujo de nuevo turno.
//
// Retorna:
//   { existe: false, turnos: [] }                              — vecino desconocido
//   { existe: true, nombre, telefono, turnos: [...] }          — vecino conocido
// =============================================================================
router.get('/vecino/:dni', async (req, res) => {
  const { dni } = req.params;

  // Validación básica de formato antes de ir a la BD
  if (!/^\d{6,10}$/.test(dni)) {
    return res.status(400).json({ error: 'El DNI debe tener entre 6 y 10 dígitos.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, nombre, telefono FROM vecinos WHERE dni = ?',
      [dni]
    );

    if (rows.length === 0) {
      return res.json({ existe: false, turnos: [] });
    }

    const vecino = rows[0];

    // Traer todos los turnos activos futuros del vecino con datos del servicio
    const [turnos] = await pool.query(`
      SELECT
        t.id,
        t.fecha,
        t.hora_inicio,
        s.id          AS servicio_id,
        s.nombre      AS servicio_nombre,
        s.duracion_min
      FROM turnos t
      JOIN servicios s ON t.servicio_id = s.id
      WHERE t.vecino_id = ?
        AND t.estado    = 'agendado'
        AND t.fecha     >= CURDATE()
      ORDER BY t.fecha ASC, t.hora_inicio ASC
    `, [vecino.id]);

    res.json({
      existe:   true,
      nombre:   vecino.nombre,
      telefono: vecino.telefono || '',
      turnos,
    });
  } catch (err) {
    logger.error('[publico] Error al buscar vecino:', err);
    res.status(500).json({ error: 'No se pudo buscar el vecino. Intentá de nuevo.' });
  }
});


// =============================================================================
// GET /api/servicios
// Lista los servicios disponibles desde motor.js.
// Reemplaza el endpoint heredado de Easy!Appointments en index.js.
// =============================================================================
router.get('/servicios', async (req, res) => {
  try {
    const servicios = await motor.obtenerServicios();
    res.json(servicios);
  } catch (err) {
    logger.error('[publico] Error al obtener servicios:', err);
    res.status(500).json({ error: 'No se pudieron obtener los servicios. Intentá de nuevo.' });
  }
});


// =============================================================================
// GET /api/servicios/:id/mensaje
// Devuelve el mensaje de confirmación de un servicio.
// El selector web lo muestra en la pantalla de éxito después de confirmar.
// =============================================================================
router.get('/servicios/:id/mensaje', async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.status(400).json({ error: 'ID de servicio inválido.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT mensaje_confirmacion FROM servicios WHERE id = ? AND activo = TRUE',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Servicio no encontrado.' });
    }

    res.json({ mensaje: rows[0].mensaje_confirmacion || null });
  } catch (err) {
    logger.error('[publico] Error al obtener mensaje del servicio:', err);
    res.status(500).json({ error: 'No se pudo obtener el mensaje.' });
  }
});


// =============================================================================
// GET /api/disponibilidad/calendario?serviceId=N&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Devuelve para cada día del rango: si tiene slots libres, si es feriado, si tiene
// bloqueo de oficina activo. Usado por el calendario visual del selector web para
// marcar días no disponibles antes de que el vecino los seleccione.
//
// El check de disponibilidad real (motor.obtenerDisponibilidadServicio) corre en
// paralelo para todos los días hábiles del rango — aceptable para el volumen de
// un calendario mensual (~22 días hábiles).
// =============================================================================
router.get('/disponibilidad/calendario', async (req, res) => {
  const { serviceId, desde, hasta } = req.query;

  if (!serviceId || !desde || !hasta) {
    return res.status(400).json({
      error: 'Faltan parámetros: serviceId, desde y hasta son obligatorios.'
    });
  }

  const serviceIdNum = parseInt(serviceId, 10);
  if (isNaN(serviceIdNum)) {
    return res.status(400).json({ error: 'serviceId debe ser un número entero.' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return res.status(400).json({ error: 'Formato de fecha inválido. Usar YYYY-MM-DD.' });
  }

  try {
    // Feriados del rango (incluye nacionales y locales de la tabla feriados)
    const [feriados] = await pool.query(
      'SELECT fecha FROM feriados WHERE fecha BETWEEN ? AND ?',
      [desde, hasta]
    );
    const feriadosSet = new Set(feriados.map(f => f.fecha.substring(0, 10)));

    // Bloqueos de oficina de día completo (hora_inicio IS NULL) para el área del servicio
    const [bloqueos] = await pool.query(`
      SELECT b.fecha_inicio, b.fecha_fin
      FROM bloqueos b
      JOIN servicios s ON b.area_id = s.area_id
      WHERE s.id          = ?
        AND b.tipo        = 'oficina'
        AND b.hora_inicio IS NULL
        AND b.fecha_inicio <= ?
        AND b.fecha_fin    >= ?
    `, [serviceIdNum, hasta, desde]);

    // Expandir rangos de bloqueo en días individuales
    const bloqueadosSet = new Set();
    bloqueos.forEach(b => {
      const cur = new Date(b.fecha_inicio.substring(0, 10) + 'T12:00:00');
      const fin = new Date(b.fecha_fin.substring(0, 10)   + 'T12:00:00');
      while (cur <= fin) {
        bloqueadosSet.add(cur.toISOString().substring(0, 10));
        cur.setDate(cur.getDate() + 1);
      }
    });

    const hoy            = new Date().toISOString().substring(0, 10);
    const dias           = {};
    const diasAVerificar = []; // días hábiles no bloqueados → verificar slots reales

    // Clasificar cada día del rango
    const cur = new Date(desde + 'T12:00:00');
    const fin = new Date(hasta + 'T12:00:00');

    while (cur <= fin) {
      const iso       = cur.toISOString().substring(0, 10);
      const diaSemana = cur.getDay(); // 0=domingo, 6=sábado

      if (diaSemana === 0 || diaSemana === 6) {
        dias[iso] = { disponible: false, feriado: false, bloqueado: false, finDeSemana: true };
      } else if (feriadosSet.has(iso)) {
        dias[iso] = { disponible: false, feriado: true, bloqueado: false, finDeSemana: false };
      } else if (bloqueadosSet.has(iso)) {
        dias[iso] = { disponible: false, feriado: false, bloqueado: true, finDeSemana: false };
      } else if (iso < hoy) {
        dias[iso] = { disponible: false, feriado: false, bloqueado: false, finDeSemana: false };
      } else {
        diasAVerificar.push(iso);
        dias[iso] = { disponible: false, feriado: false, bloqueado: false, finDeSemana: false };
      }

      cur.setDate(cur.getDate() + 1);
    }

    // Verificar disponibilidad real en paralelo para los días hábiles candidatos
    await Promise.all(diasAVerificar.map(async (iso) => {
      try {
        const disponibilidad = await motor.obtenerDisponibilidadServicio(serviceIdNum, iso);
        dias[iso].disponible = disponibilidad.horariosLibres.length > 0;
      } catch {
        // En caso de error en un día particular, queda como no disponible
      }
    }));

    res.json({ dias });

  } catch (err) {
    logger.error('[publico] Error al obtener calendario:', err);
    res.status(500).json({ error: 'No se pudo obtener el calendario. Intentá de nuevo.' });
  }
});


// =============================================================================
// GET /api/disponibilidad?serviceId=N&fecha=YYYY-MM-DD
// Horarios disponibles para un servicio en una fecha.
// Reemplaza el endpoint heredado de Easy!Appointments en index.js.
// =============================================================================
router.get('/disponibilidad', async (req, res) => {
  const { serviceId, fecha } = req.query;

  if (!serviceId || !fecha) {
    return res.status(400).json({ error: 'Faltan parámetros: serviceId y fecha son obligatorios.' });
  }

  const serviceIdNum = parseInt(serviceId, 10);
  if (isNaN(serviceIdNum)) {
    return res.status(400).json({ error: 'serviceId debe ser un número entero.' });
  }

  try {
    const disponibilidad = await motor.obtenerDisponibilidadServicio(serviceIdNum, fecha);
    res.json(disponibilidad);
  } catch (err) {
    logger.error('[publico] Error al obtener disponibilidad:', err);
    res.status(500).json({ error: 'No se pudo obtener la disponibilidad. Intentá de nuevo.' });
  }
});


// =============================================================================
// POST /api/turno
// Crea un turno desde el selector web. Canal: 'web'.
//
// Body esperado: { dni, nombre, telefono, serviceId, fecha, horario }
// El endpoint calcula el providerId (round-robin), fechaHora y fechaHoraFin.
// =============================================================================
router.post('/turno', async (req, res) => {
  const { dni, nombre, telefono, serviceId, fecha, horario } = req.body;

  if (!dni || !nombre || !serviceId || !fecha || !horario) {
    return res.status(400).json({
      error: 'Faltan datos. Se requieren: dni, nombre, serviceId, fecha, horario.'
    });
  }

  try {
    const serviceIdNum = parseInt(serviceId, 10);

    // Verificar que el vecino no tenga ya un turno activo para este trámite.
    // Previene duplicados si el vecino intenta sacar el mismo trámite dos veces.
    const [turnosActivos] = await pool.query(`
      SELECT id FROM turnos
      WHERE vecino_id = (SELECT id FROM vecinos WHERE dni = ?)
        AND servicio_id = ?
        AND estado      = 'agendado'
        AND fecha       >= CURDATE()
      LIMIT 1
    `, [dni, serviceIdNum]);

    if (turnosActivos.length > 0) {
      return res.status(409).json({
        error: 'Ya tenés un turno activo para este trámite. Cancelá el existente antes de sacar uno nuevo.'
      });
    }

    // Obtener disponibilidad para conseguir el providerId vía round-robin.
    // Mismo mecanismo que el bot de WhatsApp y el panel presencial.
    const disponibilidad = await motor.obtenerDisponibilidadServicio(serviceIdNum, fecha);
    const providerId     = disponibilidad.mapaHorarioOperador[horario];

    if (!providerId) {
      return res.status(409).json({
        error: `El horario ${horario} ya no está disponible para esa fecha. Elegí otro horario.`
      });
    }

    // Calcular la hora de fin sumando la duración del servicio al horario de inicio
    const servicios = await motor.obtenerServicios();
    const servicio  = servicios.find(s => s.id === serviceIdNum);
    if (!servicio) {
      return res.status(404).json({ error: 'Servicio no encontrado.' });
    }

    const [hh, mm]   = horario.split(':').map(Number);
    const finMin     = hh * 60 + mm + servicio.duration;
    const fechaHora    = `${fecha} ${horario}:00`;
    const fechaHoraFin = `${fecha} ${String(Math.floor(finMin / 60)).padStart(2, '0')}:${String(finMin % 60).padStart(2, '0')}:00`;

    const cita = await motor.crearCita({
      dni,
      nombre,
      telefono: telefono || null,
      serviceId: serviceIdNum,
      providerId,
      fechaHora,
      fechaHoraFin,
      canal: 'web',
    });

    logger.info(`[publico] Turno web ID ${cita.id} | DNI: ${dni} | servicio: ${serviceIdNum}`);
    res.status(201).json(cita);

  } catch (err) {
    logger.error('[publico] Error al crear turno web:', err);
    const esErrorNegocio = err.message?.includes('ya fue reservado') ||
                           err.message?.includes('ya tiene un turno');
    res.status(esErrorNegocio ? 409 : 500).json({
      error: err.message || 'No se pudo crear el turno. Intentá de nuevo.'
    });
  }
});


// =============================================================================
// DELETE /api/turno/:id
// Cancela un turno desde el selector web. Requiere motivo.
// Sin autenticación: la seguridad es mínima (PoC municipal de pequeño volumen).
// =============================================================================
router.delete('/turno/:id', async (req, res) => {
  const id         = parseInt(req.params.id, 10);
  const { motivo } = req.body;

  if (!motivo || motivo.trim().length < 3) {
    return res.status(400).json({ error: 'El motivo de cancelación es obligatorio.' });
  }

  try {
    const [rows] = await pool.query(
      "SELECT id FROM turnos WHERE id = ? AND estado = 'agendado'",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado o ya no está agendado.' });
    }

    const motivoTrim = motivo.trim();

    // Transacción: UPDATE + INSERT auditoría son atómicos
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `UPDATE turnos
           SET estado = 'cancelado', motivo_cancelacion = ?, updated_at = NOW()
         WHERE id = ?`,
        [motivoTrim, id]
      );

      // usuario_id NULL porque es una cancelación de un vecino (no de un empleado).
      // canal='web' para acciones del vecino desde el selector web.
      await conn.query(
        `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal, ip)
         VALUES (NULL, 'turno', ?, 'cancelar', ?, 'web', ?)`,
        [id, JSON.stringify({ motivo: motivoTrim, origen: 'selector_web' }), req.ip || null]
      );

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    logger.info(`[publico] Turno ${id} cancelado desde selector web — "${motivoTrim}"`);
    res.json({ ok: true });

  } catch (err) {
    logger.error('[publico] Error al cancelar turno web:', err);
    res.status(500).json({ error: 'No se pudo cancelar el turno. Intentá de nuevo.' });
  }
});


module.exports = router;
