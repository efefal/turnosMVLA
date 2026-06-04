// =============================================================
// cron.js — Recordatorios automáticos por WhatsApp
//
// Este módulo se importa desde index.js al arrancar el servidor.
// No expone endpoints HTTP: solo programa una tarea diaria que
// busca turnos del día siguiente y envía un mensaje de recordatorio
// a cada vecino que tenga teléfono registrado.
//
// CICLO DE VIDA:
//   index.js arranca → require('./cron') → iniciarCron() →
//   dos setTimeout independientes (mañana y tarde) →
//   cada uno ejecuta ejecutarRecordatorios() y se reprograma en bucle de 24h
//   La columna recordatorio_enviado garantiza que un turno no recibe
//   dos mensajes aunque ambas ejecuciones del día encuentren registros pendientes.
//
// ⚠️  IMPORTANTE — Message Templates de WhatsApp:
//   WhatsApp Business API solo permite iniciar conversaciones
//   proactivas (sin que el vecino haya escrito en las últimas 24h)
//   mediante "Message Templates" aprobados por Meta Business Manager.
//   Mientras el template NO esté aprobado, el recordatorio solo llega
//   si el vecino interactuó recientemente con el bot.
//   Cuando el template esté aprobado:
//   1. Reemplazar el objeto "type: 'text'" de enviarRecordatorio()
//      por el formato "type: 'template'" con los parámetros del template.
//   2. El resto del flujo (BD, auditoría) no cambia.
//   Ver R4 en PLAN.md para el riesgo documentado.
// =============================================================

'use strict';

const https  = require('https');
const db     = require('./db');
const logger = require('./logger');

// ---------------------------------------------------------------
// CONFIGURACIÓN
// ---------------------------------------------------------------
// El cron corre dos veces por día: una pasada de mañana y una de tarde.
// Configurables via .env con CRON_HORA_MANANA y CRON_HORA_TARDE (formato 24h).
// Defaults: 08:00 y 18:00.
// Ejemplo: CRON_HORA_MANANA=9 CRON_HORA_TARDE=17 → corre a las 09:00 y 17:00
const HORA_MANANA = parseInt(process.env.CRON_HORA_MANANA || '8',  10);
const HORA_TARDE  = parseInt(process.env.CRON_HORA_TARDE  || '18', 10);

// Credenciales de WhatsApp: las mismas variables que usa index.js.
// Se cargan porque index.js ya llamó a dotenv.config() antes de
// importar este módulo.
const WHATSAPP_TOKEN    = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// ---------------------------------------------------------------
// FUNCIÓN: enviarRecordatorio(telefono, nombre, servicio, fecha, hora)
// ---------------------------------------------------------------
// Envía un mensaje de texto de WhatsApp al vecino.
// Devuelve true si la API de Meta respondió con 2xx, false si falló.
//
// Normalización del número: igual que enviarMensaje() en index.js.
//   549XXXXXXXXXX → +54XXXXXXXXXX  (WhatsApp agrega el "9" extra de Argentina)
//   54XXXXXXXXXX  → +54XXXXXXXXXX  (ya sin el "9")
//   +XX...        → sin cambio     (ya tiene el "+")
//   XXXXXXXXXX    → +XXXXXXXXXX    (cualquier otro)
async function enviarRecordatorio(telefono, nombre, servicio, fecha, hora) {

  // Paso 1: normalizar el número al formato E.164 que exige Meta
  let telefonoNormalizado;
  if (telefono.startsWith('549')) {
    // Caso argentino con "9" extra: "549XXXX" → "+54XXXX"
    telefonoNormalizado = '+54' + telefono.slice(3);
  } else if (telefono.startsWith('54')) {
    // Caso argentino sin "9": solo agregar "+"
    telefonoNormalizado = '+' + telefono;
  } else if (telefono.startsWith('+')) {
    // Ya tiene el "+": no tocar
    telefonoNormalizado = telefono;
  } else {
    // Cualquier otro caso: agregar "+"
    telefonoNormalizado = '+' + telefono;
  }

  // Paso 2: formatear fecha "YYYY-MM-DD" → "DD/MM/YYYY" para el mensaje
  // y hora "HH:MM:SS" → "HH:MM" (el campo hora_inicio viene con segundos)
  const [anio, mes, dia] = fecha.split('-');
  const fechaLegible = `${dia}/${mes}/${anio}`;
  const horaCorta    = hora.substring(0, 5);

  // Paso 3: armar el texto del mensaje
  // Cuando el template esté aprobado por Meta, este texto se reemplaza
  // por el formato de template con variables posicionales.
  const texto = (
    `¡Hola ${nombre}! 👋\n\n` +
    `Te recordamos que *mañana ${fechaLegible}* tenés turno para *${servicio}* ` +
    `a las *${horaCorta} hs* en la Municipalidad de Villa La Angostura.\n\n` +
    `Si no podés asistir, ingresá al sistema para cancelar tu turno con anticipación.\n\n` +
    `Municipalidad de Villa La Angostura 🏛️`
  );

  const urlStr = `https://graph.facebook.com/v25.0/${WHATSAPP_PHONE_ID}/messages`;
  const urlObj = new URL(urlStr);

  const bodyStr = JSON.stringify({
    messaging_product: 'whatsapp',
    to:   telefonoNormalizado,
    type: 'text',
    text: { body: texto },
  });

  // Paso 4: enviar la solicitud HTTPS a la API de Meta
  // Usamos resolve(true/false) en lugar de reject() para que un fallo
  // de red no detenga el bucle de recordatorios de los demás vecinos.
  return new Promise((resolve) => {

    const opciones = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(opciones, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
        } else {
          logger.error(
            `[cron] Error API Meta al enviar a ${telefonoNormalizado}` +
            ` (HTTP ${res.statusCode}): ${data}`
          );
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      logger.error(
        `[cron] Error de red al enviar recordatorio a ${telefonoNormalizado}: ${err.message}`
      );
      resolve(false);
    });

    // Si Meta no responde en 30 segundos, cancelar y seguir con el siguiente
    req.setTimeout(30000, () => {
      req.destroy(new Error('Timeout al enviar recordatorio de WhatsApp'));
    });

    req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------
// FUNCIÓN PRINCIPAL: ejecutarRecordatorios()
// ---------------------------------------------------------------
// 1. Consulta la BD por turnos de mañana sin recordatorio enviado
// 2. Por cada turno: envía WhatsApp → marca recordatorio_enviado = TRUE
//    → inserta en auditoría
// 3. Si el envío falla, no marca el turno (se reintentará en la próxima
//    ejecución si el cron corre más de una vez por día, ej: tras un reinicio)
async function ejecutarRecordatorios() {
  logger.info('[cron] Iniciando envío de recordatorios para turnos de mañana...');

  // ---------------------------------------------------------------
  // PASO 1: obtener turnos de mañana con teléfono disponible
  // ---------------------------------------------------------------
  let turnos;
  try {
    const [rows] = await db.query(`
      SELECT
        t.id,
        t.fecha,
        t.hora_inicio,
        v.telefono,
        v.nombre,
        s.nombre AS servicio
      FROM   turnos    t
      JOIN   vecinos   v ON t.vecino_id   = v.id
      JOIN   servicios s ON t.servicio_id = s.id
      WHERE  t.fecha                = CURDATE() + INTERVAL 1 DAY
        AND  t.estado               = 'agendado'
        AND  t.recordatorio_enviado = FALSE
        AND  v.telefono             IS NOT NULL
      ORDER BY t.hora_inicio ASC
    `);
    turnos = rows;
  } catch (err) {
    logger.error('[cron] Error al consultar turnos para recordatorios:', err.message);
    return;
  }

  if (turnos.length === 0) {
    logger.info('[cron] Sin recordatorios pendientes para mañana.');
    return;
  }

  logger.info(`[cron] ${turnos.length} recordatorio(s) pendiente(s).`);

  // ---------------------------------------------------------------
  // PASO 2: enviar un recordatorio por turno y actualizar la BD
  // ---------------------------------------------------------------
  let enviados = 0;
  let fallidos = 0;

  for (const turno of turnos) {

    // Enviar el mensaje de WhatsApp
    const exito = await enviarRecordatorio(
      turno.telefono,
      turno.nombre,
      turno.servicio,
      turno.fecha,        // "YYYY-MM-DD"
      turno.hora_inicio   // "HH:MM:SS"
    );

    if (!exito) {
      // El envío falló: no marcar el turno para poder reintentar
      fallidos++;
      continue;
    }

    // El mensaje llegó al vecino: marcar en BD para no duplicar
    try {
      await db.query(
        'UPDATE turnos SET recordatorio_enviado = TRUE WHERE id = ?',
        [turno.id]
      );

      // Registrar en auditoría.
      // accion = 'modificar' porque cambiamos la fila del turno.
      // usuario_id = NULL porque la acción la ejecutó el sistema (no un empleado).
      // canal = 'sistema' para distinguirlo de acciones de vecinos o empleados.
      await db.query(
        `INSERT INTO auditoria
           (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal)
         VALUES (NULL, 'turno', ?, 'modificar', ?, 'sistema')`,
        [
          turno.id,
          JSON.stringify({
            accion_tipo:  'recordatorio_enviado',
            telefono:      turno.telefono,
            turno_fecha:   turno.fecha,
            turno_hora:    turno.hora_inicio.substring(0, 5),
          }),
        ]
      );

      enviados++;
      logger.info(
        `[cron] Recordatorio OK → Turno #${turno.id} | ` +
        `${turno.nombre} | ${turno.servicio} | ` +
        `${turno.fecha} ${turno.hora_inicio.substring(0, 5)}`
      );

    } catch (err) {
      // El WhatsApp llegó pero la BD no se actualizó.
      // Si el servidor reinicia y corre el cron de nuevo,
      // el vecino recibirá un segundo recordatorio del mismo turno.
      // Es un caso borde raro y preferible a no enviar ningún recordatorio.
      logger.error(
        `[cron] Mensaje enviado pero error al actualizar BD para turno #${turno.id}: ${err.message}`
      );
      fallidos++;
    }
  }

  logger.info(`[cron] Finalizado. Enviados: ${enviados} | Fallidos: ${fallidos}`);
}

// ---------------------------------------------------------------
// FUNCIÓN: calcularMsHastaProximaEjecucion(hora)
// ---------------------------------------------------------------
// Devuelve los milisegundos que faltan hasta la próxima ejecución
// a la hora indicada (en punto, minuto 0). Si esa hora ya pasó
// hoy, apunta al mismo horario del día siguiente.
//
// Nota: recalcular en cada ciclo (en lugar de setInterval de 24h)
// protege contra pequeñas derivas de reloj y cambios de horario
// de verano/invierno que podrían desplazar la hora con el tiempo.
function calcularMsHastaProximaEjecucion(hora) {
  const ahora   = new Date();
  const proxima = new Date(ahora);
  proxima.setHours(hora, 0, 0, 0);

  // Si la hora indicada de hoy ya pasó, pasar al día siguiente
  if (proxima <= ahora) {
    proxima.setDate(proxima.getDate() + 1);
  }

  return proxima - ahora;
}

// ---------------------------------------------------------------
// FUNCIÓN EXPORTADA: iniciarCron()
// ---------------------------------------------------------------
// Llamada desde index.js al arrancar el servidor.
// Crea dos bucles independientes —uno para HORA_MANANA y otro para
// HORA_TARDE— usando el mismo patrón de setTimeout recursivo.
//
// Estructura de cada bucle (idéntica para mañana y tarde):
//   iniciarCron()
//     └─ setTimeout(primer disparo a hora X) ──→ ejecutarRecordatorios()
//                                                └─ programarSiguiente(X)
//                                                     └─ setTimeout(24h aprox)
//                                                         └─ ejecutarRecordatorios()
//                                                            └─ programarSiguiente(X)
//                                                               └─ ...
//
// La columna recordatorio_enviado en la tabla turnos garantiza que
// si el turno fue procesado en la pasada de mañana, la de tarde
// no lo encuentra (WHERE recordatorio_enviado = FALSE) y lo omite.
function iniciarCron() {

  // Iniciar un bucle independiente por cada hora configurada
  for (const hora of [HORA_MANANA, HORA_TARDE]) {
    const ms             = calcularMsHastaProximaEjecucion(hora);
    const horasRestantes = (ms / 1000 / 60 / 60).toFixed(1);

    logger.info(
      `[cron] Turno ${String(hora).padStart(2, '0')}:00 habilitado ` +
      `(próxima ejecución en ${horasRestantes} h)`
    );

    // Función recursiva local: se reprograma sola cada 24h para esta hora
    function programarSiguiente() {
      const msSiguiente = calcularMsHastaProximaEjecucion(hora);
      setTimeout(async () => {
        await ejecutarRecordatorios();
        programarSiguiente();
      }, msSiguiente);
    }

    // Primer disparo: tiempo exacto hasta la hora configurada
    setTimeout(async () => {
      await ejecutarRecordatorios();
      programarSiguiente();
    }, ms);
  }
}

module.exports = { iniciarCron };
