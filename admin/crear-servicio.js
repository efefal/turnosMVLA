// admin/crear-servicio.js — Agrega un nuevo servicio (trámite) a un área municipal
//
// USO:
//   node admin/crear-servicio.js --area ID --nombre "Nombre" --duracion 30
//
// ARGUMENTOS:
//   --area         ID numérico del área a la que pertenece el servicio (obligatorio)
//   --nombre       Nombre del servicio, ej: "Renovación de Licencia"  (obligatorio)
//   --duracion     Duración de cada turno en minutos, ej: 30           (obligatorio)
//   --anticipacion Horizonte de reserva en días hábiles (opcional, default: 30)
//   --mensaje      Texto de confirmación que se envía al vecino        (opcional)
//
// NOTAS:
//   - El servicio se crea con activo=TRUE por defecto.
//   - Para asignar operadores, usar crear-horario.js después.

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
  node admin/crear-servicio.js --area ID --nombre "Nombre" --duracion MINUTOS \\
    [--anticipacion DIAS] [--mensaje "Texto para el vecino"]

EJEMPLO:
  node admin/crear-servicio.js --area 1 --nombre "Renovación de Licencia" \\
    --duracion 30 --anticipacion 45 \\
    --mensaje "Traé DNI original y licencia vencida."
`);
}

async function main() {
  const args = parsearArgs();

  const obligatorios = ['area', 'nombre', 'duracion'];
  const faltantes    = obligatorios.filter((k) => !args[k]);
  if (faltantes.length > 0) {
    console.error(`❌ Faltan argumentos: ${faltantes.map(f => `--${f}`).join(', ')}`);
    mostrarUso();
    process.exit(1);
  }

  const areaId       = parseInt(args.area,         10);
  const duracion     = parseInt(args.duracion,      10);
  const anticipacion = parseInt(args.anticipacion || '30', 10);

  if (isNaN(areaId) || areaId <= 0)         { console.error('❌ --area debe ser un entero positivo');      process.exit(1); }
  if (isNaN(duracion) || duracion <= 0)     { console.error('❌ --duracion debe ser un entero positivo');  process.exit(1); }
  if (isNaN(anticipacion) || anticipacion <= 0) { console.error('❌ --anticipacion debe ser un entero positivo'); process.exit(1); }

  // --- Verificar que el área existe ---
  const [areas] = await db.query('SELECT id, nombre FROM areas WHERE id = ?', [areaId]);
  if (areas.length === 0) {
    console.error(`❌ No existe ningún área con ID ${areaId}`);
    process.exit(1);
  }

  // --- Insertar el servicio ---
  const mensajeConfirmacion = args.mensaje || null;

  const [insertServicio] = await db.query(
    `INSERT INTO servicios (area_id, nombre, duracion_min, max_dias_anticipacion, mensaje_confirmacion)
     VALUES (?, ?, ?, ?, ?)`,
    [areaId, args.nombre, duracion, anticipacion, mensajeConfirmacion]
  );
  const servicioId = insertServicio.insertId;

  // --- Registrar en auditoría ---
  await db.query(
    `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal)
     VALUES (NULL, 'servicio', ?, 'crear', ?, 'sistema')`,
    [
      servicioId,
      JSON.stringify({ areaId, nombre: args.nombre, duracion, anticipacion }),
    ]
  );

  console.log(`\n✅ Servicio creado correctamente:`);
  console.log(`   ID:             ${servicioId}`);
  console.log(`   Área:           ${areas[0].nombre} (ID: ${areaId})`);
  console.log(`   Nombre:         ${args.nombre}`);
  console.log(`   Duración:       ${duracion} minutos`);
  console.log(`   Anticipación:   ${anticipacion} días`);
  if (mensajeConfirmacion) {
    console.log(`   Mensaje:        ${mensajeConfirmacion}`);
  } else {
    console.log(`   Mensaje:        (no configurado)`);
  }
  console.log(`\n💡 Para habilitar este servicio en el bot, agregar el ID ${servicioId} a TRAMITES_HABILITADOS en .env`);
}

main()
  .catch((err) => {
    console.error('❌ Error inesperado:', err.message);
    process.exit(1);
  })
  .finally(() => process.exit(0));
