// scripts/seed-demo.js — Puebla la base de datos con datos de demostración realistas
//
// USO:
//   node scripts/seed-demo.js
//
// IDEMPOTENTE: si se ejecuta dos veces no duplica datos.
//   Usuarios y vecinos → solo se crean si no existen (chequeo por usuario/DNI)
//   Horarios           → INSERT IGNORE (clave única por operador+servicio+día)
//   Turnos             → se omiten si ya hay ≥ 150 para los vecinos de demo
//   Auditoría          → se genera junto con los turnos; se omite si se omiten los turnos
//
// Al terminar muestra un resumen con conteos reales de la BD.

'use strict';
require('dotenv').config();

const bcrypt = require('bcrypt');
const db     = require('../db');

// ============================================================
// DATOS DE DEMO
// ============================================================

// Contraseña única para todos los usuarios de demo.
// Deben cambiarla al primer acceso real.
const PASSWORD_DEMO = 'Demo1234!';

// Empleados municipales ficticios: 3 op. Licencias, 2 op. Tribunal, 2 encargados, 1 sistemas
//
// Los valores de `usuario` coinciden con los ya migrados en la base real
// (ver public/panel/REDESIGN_USUARIO_LOGIN.md § 3 — mapeo de datos confirmado).
// El caso 'sistemas.demo' NO es la derivación automática del email
// (que daría 'sistemas') — es el override manual ya aplicado en la
// migración, porque colisionaba con el usuario real 'sistemas'. Si este
// seed corre de nuevo, tiene que buscar por este mismo valor para
// encontrar la fila ya migrada y no crear un usuario duplicado.
const USUARIOS_DEMO = [
  { nombre: 'Alejandro Bianchi',   usuario: 'op1.lic',        rol: 'operador',  areaNombre: 'Licencias de Conducir' },
  { nombre: 'Valeria Muñoz',       usuario: 'op2.lic',        rol: 'operador',  areaNombre: 'Licencias de Conducir' },
  { nombre: 'Diego Saavedra',      usuario: 'op3.lic',        rol: 'operador',  areaNombre: 'Licencias de Conducir' },
  { nombre: 'Claudia Ferreira',    usuario: 'op1.trib',       rol: 'operador',  areaNombre: 'Tribunal de Faltas'    },
  { nombre: 'Marcelo Ríos',        usuario: 'op2.trib',       rol: 'operador',  areaNombre: 'Tribunal de Faltas'    },
  { nombre: 'Laura Montoya',       usuario: 'enc.lic',        rol: 'encargado', areaNombre: 'Licencias de Conducir' },
  { nombre: 'Roberto Ceballos',    usuario: 'enc.trib',       rol: 'encargado', areaNombre: 'Tribunal de Faltas'    },
  { nombre: 'Admin Sistemas Demo', usuario: 'sistemas.demo',  rol: 'sistemas',  areaNombre: 'Licencias de Conducir' },
];

// Banco de nombres y apellidos para 50 vecinos ficticios
const NOMBRES_FICTICIOS = [
  'Ana', 'Carlos', 'María', 'Juan', 'Laura', 'Roberto', 'Claudia', 'Diego',
  'Sofía', 'Marcelo', 'Valeria', 'Sebastián', 'Patricia', 'Andrés', 'Natalia',
  'Fernando', 'Elena', 'Gustavo', 'Florencia', 'Pablo', 'Romina', 'Daniel',
  'Verónica', 'Javier', 'Luciana', 'Miguel', 'Cecilia', 'Hernán', 'Beatriz',
  'Alejandro', 'Gabriela', 'Luis', 'Silvia', 'Rodrigo', 'Cristina', 'Matías',
  'Sandra', 'Nicolás', 'Carmen', 'Tomás', 'Adriana', 'Federico', 'Rosa',
  'Santiago', 'Mónica', 'Maximiliano', 'Teresa', 'Emilio', 'Victoria', 'Ramón',
];

const APELLIDOS_FICTICIOS = [
  'García', 'López', 'Martínez', 'Fernández', 'Rodríguez', 'González',
  'Pérez', 'Sánchez', 'Romero', 'Torres', 'Díaz', 'Ruiz', 'Molina',
  'Moreno', 'Álvarez', 'Castro', 'Delgado', 'Vega', 'Gutiérrez',
  'Herrera', 'Ramos', 'Vargas', 'Medina', 'Acosta', 'Flores', 'Ríos',
  'Ortiz', 'Mendoza', 'Reyes', 'Suárez', 'Silva', 'Paredes', 'Salazar',
  'Espinoza', 'Carrasco', 'Navarro', 'Cruz', 'Jiménez', 'Cabrera', 'Quiroga',
];

// Distribución de canales con pesos: 60% WhatsApp, 25% web, 15% presencial
const CANALES_PESO = [
  { valor: 'whatsapp',   peso: 60 },
  { valor: 'web',        peso: 25 },
  { valor: 'presencial', peso: 15 },
];

// Distribución de estados para turnos ya pasados
const ESTADOS_PASADOS_PESO = [
  { valor: 'atendido',  peso: 50 },
  { valor: 'ausente',   peso: 20 },
  { valor: 'cancelado', peso: 30 },
];

// Slots de atención de Licencias de Conducir: 30 min, 08:00–13:00
const SLOTS_LIC  = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30'];

// Slots de Tribunal de Faltas: 15 min, 09:00–14:00 (generados automáticamente)
const SLOTS_TRIB = [];
for (let min = 9 * 60; min < 14 * 60; min += 15) {
  SLOTS_TRIB.push(
    `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  );
}
// SLOTS_TRIB queda con 20 horarios: '09:00', '09:15', ..., '13:45'

// Horas de login verosímiles (inicio de jornada)
const HORAS_LOGIN = [
  '07:45:00', '07:50:00', '07:55:00', '08:00:00', '08:05:00',
  '08:10:00', '08:15:00', '08:20:00', '08:25:00', '08:30:00',
];

// Mapeo canal_origen del turno → canal de auditoría
const CANAL_AUDITORIA = {
  whatsapp:   'bot',
  web:        'web',
  presencial: 'panel',
};

// ============================================================
// UTILIDADES
// ============================================================

// Devuelve todos los días hábiles (lunes a viernes) en el rango dado.
// Las fechas se pasan y devuelven como strings "YYYY-MM-DD".
function diasHabiles(desde, hasta) {
  const dias   = [];
  const actual = new Date(desde + 'T00:00:00');
  const fin    = new Date(hasta  + 'T00:00:00');
  while (actual <= fin) {
    const dow = actual.getDay(); // 0=Dom, 1=Lun, ..., 6=Sáb
    if (dow >= 1 && dow <= 5) {
      dias.push(toYMD(actual));
    }
    actual.setDate(actual.getDate() + 1);
  }
  return dias;
}

// Suma N minutos a "HH:MM" y devuelve "HH:MM"
function addMin(hora, min) {
  const [h, m] = hora.split(':').map(Number);
  const total  = h * 60 + m + min;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Formatea un objeto Date a "YYYY-MM-DD" usando la fecha local (sin conversión UTC)
function toYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Devuelve el elemento en posición (i % arr.length), distribución cíclica
function cycle(arr, i) {
  return arr[i % arr.length];
}

// Elige un valor al azar respetando los pesos definidos en el array
// Cada elemento debe tener { valor, peso }
function elegirConPeso(opciones) {
  const total = opciones.reduce((s, o) => s + o.peso, 0);
  let r = Math.random() * total;
  for (const o of opciones) {
    r -= o.peso;
    if (r <= 0) return o.valor;
  }
  return opciones[opciones.length - 1].valor;
}

// ============================================================
// FUNCIÓN PRINCIPAL
// ============================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' 🌱  Seed de demostración — Motor de Turnos MVLA');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── 0. Leer áreas y servicios desde la BD ───────────────────
  // No hardcodeamos IDs por si la BD fue recreada y el autoincrement arrancó
  // de un número distinto.
  const [areas]     = await db.query('SELECT id, nombre FROM areas    WHERE activo = TRUE');
  const [servicios] = await db.query('SELECT id, area_id, nombre, duracion_min FROM servicios WHERE activo = TRUE');

  if (!areas.length || !servicios.length) {
    console.error('❌  La BD no tiene áreas o servicios activos. Ejecutá el script SQL base primero.');
    process.exit(1);
  }

  // Mapa nombre → objeto área para buscar sin hardcodear IDs
  const areaPorNombre = {};
  for (const a of areas) areaPorNombre[a.nombre] = a;

  // Primer servicio por área (el PoC tiene uno por área: una Licencia y un Pago de Multas)
  const svcPorAreaId = {};
  for (const s of servicios) {
    if (!svcPorAreaId[s.area_id]) svcPorAreaId[s.area_id] = s;
  }

  const areaLic  = areaPorNombre['Licencias de Conducir'];
  const areaTrib = areaPorNombre['Tribunal de Faltas'];
  const svcLic   = areaLic  ? svcPorAreaId[areaLic.id]  : null;
  const svcTrib  = areaTrib ? svcPorAreaId[areaTrib.id] : null;

  console.log('📋 Áreas:    ', areas.map(a => `${a.nombre} (ID ${a.id})`).join('  |  '));
  console.log('📋 Servicios:', servicios.map(s => `${s.nombre} (ID ${s.id}, ${s.duracion_min} min)`).join('  |  '));
  console.log('');

  // ── PASO 1: USUARIOS ────────────────────────────────────────
  console.log('── Paso 1 de 5: Usuarios ─────────────────────────────────');

  // Encriptamos la contraseña una sola vez para todos (evita repetir el trabajo criptográfico)
  const passwordHash = await bcrypt.hash(PASSWORD_DEMO, 10);

  const opsLicIds  = []; // IDs de operadores de Licencias (para horarios y turnos)
  const opsTribIds = []; // IDs de operadores de Tribunal  (para horarios y turnos)
  let usuariosCreados   = 0;
  let usuariosExistentes = 0;

  for (const u of USUARIOS_DEMO) {
    const area = areaPorNombre[u.areaNombre];
    if (!area) {
      console.warn(`  ⚠️  Área "${u.areaNombre}" no encontrada en BD. Saltando ${u.usuario}.`);
      continue;
    }

    // Idempotencia: buscar por usuario antes de crear
    const [rowsUser] = await db.query('SELECT id FROM usuarios WHERE usuario = ?', [u.usuario]);
    let uid;

    if (rowsUser.length > 0) {
      uid = rowsUser[0].id;
      usuariosExistentes++;
    } else {
      // Crear usuario y su asignación de área en una sola transacción atómica.
      // Si falla la asignación, el usuario tampoco queda creado a medias.
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

        const [insUser] = await conn.query(
          'INSERT INTO usuarios (nombre, usuario, password_hash) VALUES (?, ?, ?)',
          [u.nombre, u.usuario, passwordHash]
        );
        uid = insUser.insertId;

        await conn.query(
          'INSERT INTO usuario_areas (usuario_id, area_id, rol) VALUES (?, ?, ?)',
          [uid, area.id, u.rol]
        );

        await conn.query(
          `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal)
           VALUES (NULL, 'usuario', ?, 'crear', ?, 'sistema')`,
          [uid, JSON.stringify({ nombre: u.nombre, usuario: u.usuario, rol: u.rol, area: area.nombre })]
        );

        await conn.commit();
        usuariosCreados++;
        console.log(`  ✅ ${u.nombre.padEnd(26)} ${u.rol.padEnd(10)} ${u.areaNombre}`);
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }

    // Asegurar la entrada en usuario_areas incluso si el usuario ya existía
    // (por si una corrida anterior falló a mitad de la transacción)
    await db.query(
      'INSERT IGNORE INTO usuario_areas (usuario_id, area_id, rol) VALUES (?, ?, ?)',
      [uid, area.id, u.rol]
    );

    // Acumular IDs de operadores para los pasos de horarios y turnos
    if (u.rol === 'operador') {
      if (u.areaNombre === 'Licencias de Conducir') opsLicIds.push(uid);
      if (u.areaNombre === 'Tribunal de Faltas')    opsTribIds.push(uid);
    }
  }

  if (usuariosExistentes > 0) {
    console.log(`  ℹ️  ${usuariosExistentes} usuario(s) ya existían (sin cambios)`);
  }
  console.log('');

  // ── PASO 2: HORARIOS ────────────────────────────────────────
  console.log('── Paso 2 de 5: Horarios ─────────────────────────────────');

  let horariosInsertados = 0;
  const DIAS_LV = [1, 2, 3, 4, 5]; // 1=lunes a 5=viernes (según columna dia_semana)

  // Asigna el mismo horario lunes-viernes a un operador para un servicio.
  // INSERT IGNORE descarta el insert silenciosamente si ya existe el horario.
  async function asignarHorario(usuarioId, servicioId, horaInicio, horaFin) {
    for (const dia of DIAS_LV) {
      const [res] = await db.query(
        `INSERT IGNORE INTO horarios (usuario_id, servicio_id, dia_semana, hora_inicio, hora_fin)
         VALUES (?, ?, ?, ?, ?)`,
        [usuarioId, servicioId, dia, horaInicio, horaFin]
      );
      if (res.affectedRows > 0) horariosInsertados++;
    }
  }

  if (svcLic) {
    for (const uid of opsLicIds) await asignarHorario(uid, svcLic.id, '08:00', '13:00');
  }
  if (svcTrib) {
    for (const uid of opsTribIds) await asignarHorario(uid, svcTrib.id, '09:00', '14:00');
  }

  const horariosIgnorados = (opsLicIds.length * 5) + (opsTribIds.length * 5) - horariosInsertados;
  console.log(`  ✅ ${horariosInsertados} horarios insertados${horariosIgnorados > 0 ? `, ${horariosIgnorados} ya existían` : ''}`);
  console.log('');

  // ── PASO 3: VECINOS ─────────────────────────────────────────
  console.log('── Paso 3 de 5: Vecinos ──────────────────────────────────');

  const CANALES_REGISTRO = ['whatsapp', 'web', 'presencial'];
  const vecinoIds       = [];
  let vecinosCreados    = 0;
  let vecinosExistentes = 0;

  for (let i = 0; i < 50; i++) {
    // DNI en serie ficticia 99 + 6 dígitos — fácil de identificar como datos de demo
    const dni      = `99${String(i + 1).padStart(6, '0')}`;
    const nombre   = `${NOMBRES_FICTICIOS[i]} ${APELLIDOS_FICTICIOS[i % APELLIDOS_FICTICIOS.length]}`;
    // Teléfono: código de área 2944 (Villa La Angostura) + 6 dígitos únicos
    const telefono = `2944${String(100000 + i).padStart(6, '0')}`;
    const canal    = CANALES_REGISTRO[i % CANALES_REGISTRO.length];

    const [rowsVec] = await db.query('SELECT id FROM vecinos WHERE dni = ?', [dni]);

    if (rowsVec.length > 0) {
      vecinoIds.push(rowsVec[0].id);
      vecinosExistentes++;
    } else {
      const [insVec] = await db.query(
        'INSERT INTO vecinos (dni, nombre, telefono, canal_registro) VALUES (?, ?, ?, ?)',
        [dni, nombre, telefono, canal]
      );
      vecinoIds.push(insVec.insertId);
      vecinosCreados++;
    }
  }

  console.log(`  ✅ ${vecinosCreados} vecinos creados`);
  if (vecinosExistentes > 0) console.log(`  ℹ️  ${vecinosExistentes} vecinos ya existían (sin cambios)`);
  console.log('');

  // ── PASO 4: TURNOS Y AUDITORÍA ──────────────────────────────
  console.log('── Paso 4 de 5: Turnos ───────────────────────────────────');

  // Idempotencia: verificar si ya existen ≥ 150 turnos para los vecinos de demo
  const phVecinos = vecinoIds.map(() => '?').join(',');
  const [rowsCnt] = await db.query(
    `SELECT COUNT(*) AS total FROM turnos WHERE vecino_id IN (${phVecinos})`,
    vecinoIds
  );
  const turnosExistentes = rowsCnt[0].total;

  let turnosCreados  = 0;
  let auditoriaExtra = 0;

  if (turnosExistentes >= 150) {
    console.log(`  ℹ️  Ya existen ${turnosExistentes} turnos para los vecinos de demo. Se omite este paso.\n`);
  } else {
    // Calcular rango de fechas.
    // Para que la distribución sea correcta en la pantalla de auditoría y dashboard,
    // los turnos pasados cubren los últimos 60 días y los futuros los próximos 30.
    const hoy    = new Date(); hoy.setHours(0, 0, 0, 0);
    const hace60 = new Date(hoy); hace60.setDate(hoy.getDate() - 60);
    const ayer   = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    const manana = new Date(hoy); manana.setDate(hoy.getDate() + 1);
    const en30   = new Date(hoy); en30.setDate(hoy.getDate() + 30);

    const diasPasados = diasHabiles(toYMD(hace60), toYMD(ayer));
    const diasFuturos = diasHabiles(toYMD(manana), toYMD(en30));

    if (!diasPasados.length || !diasFuturos.length) {
      console.warn('  ⚠️  No se encontraron días hábiles en el rango. Verificar fechas del sistema.');
    }

    // Función que inserta un turno y su registro de auditoría correspondiente.
    // Para turnos cancelados agrega además el evento 'cancelar'.
    async function insertarTurno({ vecinoId, servicioId, operadorId, fecha, horaInicio, duracion, estado, canal }) {
      const horaFin = addMin(horaInicio, duracion);

      const [insTurno] = await db.query(
        `INSERT INTO turnos (vecino_id, servicio_id, operador_id, fecha, hora_inicio, hora_fin, estado, canal_origen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [vecinoId, servicioId, operadorId, fecha, horaInicio, horaFin, estado, canal]
      );
      const turnoId = insTurno.insertId;
      turnosCreados++;

      // Registrar la creación del turno en auditoría
      const canalAudit = CANAL_AUDITORIA[canal] || 'sistema';
      await db.query(
        `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal)
         VALUES (NULL, 'turno', ?, 'crear', ?, ?)`,
        [turnoId, JSON.stringify({ vecino_id: vecinoId, fecha, hora: horaInicio, canal }), canalAudit]
      );
      auditoriaExtra++;

      // Los turnos cancelados tienen además un evento de cancelación posterior
      if (estado === 'cancelado') {
        await db.query(
          `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal)
           VALUES (NULL, 'turno', ?, 'cancelar', ?, ?)`,
          [turnoId, JSON.stringify({ motivo: 'cancelado por el vecino', fecha }), canalAudit]
        );
        auditoriaExtra++;
      }
    }

    // Round-robin para repartir equitativamente entre operadores de cada área
    let rroLic = 0, rroTrib = 0;

    // ── 100 TURNOS PASADOS ───────────────────────────────────
    // Distribuidos a lo largo de los últimos 60 días hábiles.
    // Estados variados: 50% atendido, 20% ausente, 30% cancelado.
    // Alternamos entre Licencias (par) y Tribunal (impar).
    for (let i = 0; i < 100; i++) {
      const fecha  = cycle(diasPasados, Math.floor(i * diasPasados.length / 100));
      const canal  = elegirConPeso(CANALES_PESO);
      const estado = elegirConPeso(ESTADOS_PASADOS_PESO);
      const vecino = cycle(vecinoIds, i);
      const usaLic = (i % 2 === 0);

      if (usaLic && svcLic && opsLicIds.length) {
        await insertarTurno({
          vecinoId:   vecino,
          servicioId: svcLic.id,
          operadorId: cycle(opsLicIds, rroLic++),
          fecha,
          horaInicio: cycle(SLOTS_LIC, i),
          duracion:   svcLic.duracion_min,
          estado,
          canal,
        });
      } else if (!usaLic && svcTrib && opsTribIds.length) {
        await insertarTurno({
          vecinoId:   vecino,
          servicioId: svcTrib.id,
          operadorId: cycle(opsTribIds, rroTrib++),
          fecha,
          horaInicio: cycle(SLOTS_TRIB, i),
          duracion:   svcTrib.duracion_min,
          estado,
          canal,
        });
      }
    }

    // ── 50 TURNOS FUTUROS ────────────────────────────────────
    // Todos en estado 'agendado'.
    // Usamos vecinos distintos a los de los pasados (desplazados 25 posiciones)
    // para simular que son personas distintas las que están esperando.
    for (let i = 0; i < 50; i++) {
      const fecha  = cycle(diasFuturos, Math.floor(i * diasFuturos.length / 50));
      const canal  = elegirConPeso(CANALES_PESO);
      const vecino = cycle(vecinoIds, i + 25);
      const usaLic = (i % 2 === 0);

      if (usaLic && svcLic && opsLicIds.length) {
        await insertarTurno({
          vecinoId:   vecino,
          servicioId: svcLic.id,
          operadorId: cycle(opsLicIds, rroLic++),
          fecha,
          horaInicio: cycle(SLOTS_LIC, i + 3),  // +3 para que no arranquen todos desde 08:00
          duracion:   svcLic.duracion_min,
          estado:     'agendado',
          canal,
        });
      } else if (!usaLic && svcTrib && opsTribIds.length) {
        await insertarTurno({
          vecinoId:   vecino,
          servicioId: svcTrib.id,
          operadorId: cycle(opsTribIds, rroTrib++),
          fecha,
          horaInicio: cycle(SLOTS_TRIB, i + 3),
          duracion:   svcTrib.duracion_min,
          estado:     'agendado',
          canal,
        });
      }
    }

    console.log(`  ✅ ${turnosCreados} turnos insertados (${auditoriaExtra} registros de auditoría generados)\n`);
  }

  // ── PASO 5: LOGINS DE AUDITORÍA ─────────────────────────────
  // Simula los eventos de inicio de sesión de los empleados durante el último mes.
  // Útil para que la pantalla de Auditoría tenga variedad de acción='login'.
  console.log('── Paso 5 de 5: Eventos de login ─────────────────────────');

  const [rowsLoginCnt] = await db.query(
    `SELECT COUNT(*) AS total FROM auditoria
     WHERE accion = 'login' AND canal = 'panel'
     AND timestamp >= DATE_SUB(NOW(), INTERVAL 60 DAY)`
  );
  const loginsExistentes = rowsLoginCnt[0].total;

  if (loginsExistentes >= 40) {
    console.log(`  ℹ️  Ya existen ${loginsExistentes} registros de login. Se omite este paso.\n`);
  } else {
    // Buscar los IDs de todos los usuarios de demo que ya existen en la BD
    const usuariosDemo = USUARIOS_DEMO.map(u => u.usuario);
    const phUsuarios   = usuariosDemo.map(() => '?').join(',');
    const [rowsUsers] = await db.query(
      `SELECT id FROM usuarios WHERE usuario IN (${phUsuarios})`,
      usuariosDemo
    );
    const userIdsDemo = rowsUsers.map(u => u.id);

    const hoy    = new Date(); hoy.setHours(0, 0, 0, 0);
    const hace30 = new Date(hoy); hace30.setDate(hoy.getDate() - 30);
    const ayer   = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    const dias30 = diasHabiles(toYMD(hace30), toYMD(ayer));

    let loginsCreados = 0;

    for (let i = 0; i < 40; i++) {
      const uid  = cycle(userIdsDemo, i);
      const ts   = `${cycle(dias30, i)} ${cycle(HORAS_LOGIN, i)}`;

      await db.query(
        `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal, timestamp)
         VALUES (?, 'usuario', ?, 'login', ?, 'panel', ?)`,
        [uid, uid, JSON.stringify({ fuente: 'seed-demo' }), ts]
      );
      loginsCreados++;
    }

    console.log(`  ✅ ${loginsCreados} registros de login insertados\n`);
    auditoriaExtra += loginsCreados;
  }

  // ── RESUMEN FINAL ────────────────────────────────────────────
  const [cntU]  = await db.query('SELECT COUNT(*) AS n FROM usuarios');
  const [cntV]  = await db.query('SELECT COUNT(*) AS n FROM vecinos');
  const [cntT]  = await db.query('SELECT COUNT(*) AS n FROM turnos');
  const [cntA]  = await db.query('SELECT COUNT(*) AS n FROM auditoria');
  const [byEst] = await db.query('SELECT estado, COUNT(*) AS qty FROM turnos GROUP BY estado ORDER BY qty DESC');
  const [byCan] = await db.query('SELECT canal_origen, COUNT(*) AS qty FROM turnos GROUP BY canal_origen ORDER BY qty DESC');
  const [byArea] = await db.query(`
    SELECT s.nombre AS servicio, COUNT(*) AS qty
    FROM turnos t JOIN servicios s ON t.servicio_id = s.id
    GROUP BY t.servicio_id ORDER BY qty DESC`);

  console.log('── Resumen de la base de datos ───────────────────────────');
  console.log('');
  console.log(`  👤 Usuarios:   ${cntU[0].n}`);
  console.log(`  👥 Vecinos:    ${cntV[0].n}`);
  console.log(`  📅 Turnos:     ${cntT[0].n}`);
  console.log('     Por estado:');
  for (const r of byEst)  console.log(`       ${r.estado.padEnd(12)} ${r.qty}`);
  console.log('     Por canal:');
  for (const r of byCan)  console.log(`       ${r.canal_origen.padEnd(12)} ${r.qty}`);
  console.log('     Por servicio:');
  for (const r of byArea) console.log(`       ${r.servicio.padEnd(20)} ${r.qty}`);
  console.log(`  📋 Auditoría:  ${cntA[0].n}`);
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✅  Seed completado. Credenciales de acceso al panel:   ║');
  console.log('║                                                          ║');
  console.log('║  Sistemas:   sistemas.demo                               ║');
  console.log('║  Encargado:  enc.lic                                     ║');
  console.log('║  Operador:   op1.lic                                     ║');
  console.log(`║  Contraseña: ${PASSWORD_DEMO.padEnd(47)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
}

main()
  .catch(err => {
    console.error('\n❌ Error fatal:', err.message);
    console.error(err.stack);
    process.exit(1);
  })
  .finally(() => process.exit(0));
