// admin/crear-horario.js — Asigna un bloque horario a un operador
//
// USO:
//   node admin/crear-horario.js --usuario ID --servicio ID --dia 1 \
//     --inicio 08:00 --fin 13:00
//
// ARGUMENTOS OBLIGATORIOS:
//   --usuario  ID numérico del operador (debe existir en tabla usuarios)
//   --servicio ID numérico del servicio (debe existir en tabla servicios)
//   --dia      Día de la semana: 1=lunes, 2=martes, ... 7=domingo
//   --inicio   Hora de inicio en formato HH:MM (ej: 08:00)
//   --fin      Hora de fin en formato HH:MM (ej: 13:00)
//
// NOTAS:
//   - Un operador no puede tener dos horarios para el mismo servicio y día
//     (restricción UNIQUE en la tabla). El script lo detecta y muestra un error claro.
//   - hora_fin debe ser posterior a hora_inicio.

'use strict';

require('dotenv').config();

const db = require('../db');

function parsearArgs() {
  const args = process.argv.slice(2);
  const mapa = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      mapa[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return mapa;
}

function mostrarUso() {
  console.error(`
USO:
  node admin/crear-horario.js --usuario ID --servicio ID --dia 1-7 \\
    --inicio HH:MM --fin HH:MM

DÍAS:
  1=lunes  2=martes  3=miércoles  4=jueves  5=viernes  6=sábado  7=domingo

EJEMPLO:
  node admin/crear-horario.js --usuario 3 --servicio 1 --dia 1 \\
    --inicio 08:00 --fin 13:00
`);
}

// Convierte "HH:MM" a minutos desde medianoche para comparar horas
function horaAMinutos(horaStr) {
  const [hh, mm] = horaStr.split(':').map(Number);
  return hh * 60 + mm;
}

// Valida que una hora tenga el formato HH:MM con valores numéricos razonables
function esHoraValida(horaStr) {
  if (!horaStr || !/^\d{2}:\d{2}$/.test(horaStr)) return false;
  const [hh, mm] = horaStr.split(':').map(Number);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

const DIAS = { 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado', 7: 'domingo' };

async function main() {
  const args = parsearArgs();

  const obligatorios = ['usuario', 'servicio', 'dia', 'inicio', 'fin'];
  const faltantes    = obligatorios.filter((k) => !args[k]);
  if (faltantes.length > 0) {
    console.error(`❌ Faltan argumentos: ${faltantes.map(f => `--${f}`).join(', ')}`);
    mostrarUso();
    process.exit(1);
  }

  const usuarioId  = parseInt(args.usuario,  10);
  const servicioId = parseInt(args.servicio, 10);
  const dia        = parseInt(args.dia,      10);

  if (isNaN(usuarioId)  || usuarioId  <= 0) { console.error('❌ --usuario debe ser un entero positivo');  process.exit(1); }
  if (isNaN(servicioId) || servicioId <= 0) { console.error('❌ --servicio debe ser un entero positivo'); process.exit(1); }
  if (isNaN(dia) || dia < 1 || dia > 7)     { console.error('❌ --dia debe ser un número entre 1 y 7');   process.exit(1); }
  if (!esHoraValida(args.inicio))           { console.error(`❌ --inicio no es una hora válida: "${args.inicio}"`); process.exit(1); }
  if (!esHoraValida(args.fin))              { console.error(`❌ --fin no es una hora válida: "${args.fin}"`);       process.exit(1); }

  if (horaAMinutos(args.inicio) >= horaAMinutos(args.fin)) {
    console.error(`❌ --fin (${args.fin}) debe ser posterior a --inicio (${args.inicio})`);
    process.exit(1);
  }

  // --- Verificar que el usuario existe ---
  const [usuarios] = await db.query('SELECT id, nombre FROM usuarios WHERE id = ? AND activo = TRUE', [usuarioId]);
  if (usuarios.length === 0) {
    console.error(`❌ No existe ningún operador activo con ID ${usuarioId}`);
    process.exit(1);
  }

  // --- Verificar que el servicio existe ---
  const [servicios] = await db.query('SELECT id, nombre FROM servicios WHERE id = ? AND activo = TRUE', [servicioId]);
  if (servicios.length === 0) {
    console.error(`❌ No existe ningún servicio activo con ID ${servicioId}`);
    process.exit(1);
  }

  // --- Verificar que no existe ya ese horario (constraint UNIQUE) ---
  const [existentes] = await db.query(
    'SELECT id FROM horarios WHERE usuario_id = ? AND servicio_id = ? AND dia_semana = ?',
    [usuarioId, servicioId, dia]
  );
  if (existentes.length > 0) {
    console.error(
      `❌ ${usuarios[0].nombre} ya tiene un horario para "${servicios[0].nombre}" ` +
      `los ${DIAS[dia]} (ID horario: ${existentes[0].id}). ` +
      `Para modificarlo, actualizar directamente en la base de datos.`
    );
    process.exit(1);
  }

  // --- Insertar horario ---
  const [insertHorario] = await db.query(
    'INSERT INTO horarios (usuario_id, servicio_id, dia_semana, hora_inicio, hora_fin) VALUES (?, ?, ?, ?, ?)',
    [usuarioId, servicioId, dia, args.inicio, args.fin]
  );
  const horarioId = insertHorario.insertId;

  // --- Registrar en auditoría ---
  await db.query(
    `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal)
     VALUES (NULL, 'horario', ?, 'crear', ?, 'sistema')`,
    [
      horarioId,
      JSON.stringify({ usuarioId, servicioId, dia, inicio: args.inicio, fin: args.fin }),
    ]
  );

  console.log(`\n✅ Horario creado correctamente:`);
  console.log(`   ID horario:  ${horarioId}`);
  console.log(`   Operador:    ${usuarios[0].nombre} (ID: ${usuarioId})`);
  console.log(`   Servicio:    ${servicios[0].nombre} (ID: ${servicioId})`);
  console.log(`   Día:         ${DIAS[dia]} (${dia})`);
  console.log(`   Horario:     ${args.inicio} → ${args.fin}`);
}

main()
  .catch((err) => {
    console.error('❌ Error inesperado:', err.message);
    process.exit(1);
  })
  .finally(() => process.exit(0));
