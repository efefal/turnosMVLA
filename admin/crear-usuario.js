// admin/crear-usuario.js — Crea un empleado municipal en la base de datos
//
// USO:
//   node admin/crear-usuario.js --nombre "Ana García" --usuario ana.garcia \
//     --password secreto123 --area 1 --rol operador
//
// ARGUMENTOS OBLIGATORIOS:
//   --nombre   Nombre completo del empleado
//   --usuario  Nombre de usuario para el login (minúsculas, números, punto, guion bajo)
//   --password Contraseña en texto plano (se encripta con bcrypt antes de guardar)
//   --area     ID numérico del área a la que pertenece
//   --rol      Rol en esa área: "operador", "encargado" o "sistemas"

'use strict';

require('dotenv').config();

const bcrypt = require('bcrypt');
const db     = require('../db');

// --- Parseo de argumentos de línea de comandos ---
// Node.js pone todos los argumentos en process.argv.
// Los primeros dos son siempre: ruta de node y ruta del script.
// El resto son los argumentos que escribió el usuario.
// Ejemplo: ["node", "crear-usuario.js", "--nombre", "Ana García", "--usuario", "..."]
function parsearArgs() {
  const args  = process.argv.slice(2); // descartamos los primeros dos
  const mapa  = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const clave = args[i].slice(2);   // "--nombre" → "nombre"
      const valor = args[i + 1];        // el siguiente elemento es el valor
      mapa[clave] = valor;
      i++;                              // saltamos el valor en la próxima iteración
    }
  }
  return mapa;
}

function mostrarUso() {
  console.error(`
USO:
  node admin/crear-usuario.js --nombre "Nombre Apellido" --usuario nombre.apellido \\
    --password contraseña --area ID_AREA --rol operador|encargado|sistemas

EJEMPLO:
  node admin/crear-usuario.js --nombre "Ana García" --usuario ana.garcia \\
    --password secreto123 --area 1 --rol operador
`);
}

async function main() {
  const args = parsearArgs();

  // Verificar que todos los argumentos obligatorios estén presentes
  const obligatorios = ['nombre', 'usuario', 'password', 'area', 'rol'];
  const faltantes    = obligatorios.filter((k) => !args[k]);

  if (faltantes.length > 0) {
    console.error(`❌ Faltan argumentos obligatorios: ${faltantes.map(f => `--${f}`).join(', ')}`);
    mostrarUso();
    process.exit(1);
  }

  // Validar que el rol sea uno de los valores permitidos.
  // "sistemas" = máximo privilegio, se usa para el bootstrap inicial del panel.
  if (!['operador', 'encargado', 'sistemas'].includes(args.rol)) {
    console.error(`❌ --rol debe ser "operador", "encargado" o "sistemas", recibido: "${args.rol}"`);
    mostrarUso();
    process.exit(1);
  }

  // Validar que --area sea un número entero
  const areaId = parseInt(args.area, 10);
  if (isNaN(areaId) || areaId <= 0) {
    console.error(`❌ --area debe ser un número entero positivo, recibido: "${args.area}"`);
    process.exit(1);
  }

  // --- Verificar que el área existe ---
  const [areas] = await db.query('SELECT id, nombre FROM areas WHERE id = ?', [areaId]);
  if (areas.length === 0) {
    console.error(`❌ No existe ningún área con ID ${areaId}`);
    process.exit(1);
  }
  console.log(`📍 Área encontrada: ${areas[0].nombre}`);

  // --- Verificar que el usuario no esté ya registrado ---
  const [existentes] = await db.query('SELECT id FROM usuarios WHERE usuario = ?', [args.usuario]);
  if (existentes.length > 0) {
    console.error(`❌ Ya existe un usuario con el nombre de usuario "${args.usuario}" (ID: ${existentes[0].id})`);
    process.exit(1);
  }

  // --- Encriptar la contraseña con bcrypt ---
  // El número 10 es el "salt rounds": cuántas veces se aplica el algoritmo de hash.
  // A mayor número, más seguro pero más lento. 10 es el estándar recomendado.
  console.log('🔐 Encriptando contraseña...');
  const passwordHash = await bcrypt.hash(args.password, 10);

  // --- Insertar usuario y asignación de área en transacción ---
  // Usamos transacción para que si falla la asignación al área,
  // tampoco quede el usuario sin área creado a medias.
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [insertUsuario] = await conn.query(
      'INSERT INTO usuarios (nombre, usuario, password_hash) VALUES (?, ?, ?)',
      [args.nombre, args.usuario, passwordHash]
    );
    const usuarioId = insertUsuario.insertId;

    // Los operadores atienden turnos y ocupan slots de disponibilidad.
    // Los encargados administran pero no atienden — atiende_turnos = FALSE por defecto.
    const atiendeT = args.rol === 'operador' ? 1 : 0;
    await conn.query(
      'INSERT INTO usuario_areas (usuario_id, area_id, rol, atiende_turnos) VALUES (?, ?, ?, ?)',
      [usuarioId, areaId, args.rol, atiendeT]
    );

    // Registrar en auditoría
    await conn.query(
      `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal)
       VALUES (NULL, 'usuario', ?, 'crear', ?, 'sistema')`,
      [
        usuarioId,
        JSON.stringify({ nombre: args.nombre, usuario: args.usuario, area: areaId, rol: args.rol }),
      ]
    );

    await conn.commit();

    console.log(`\n✅ Usuario creado correctamente:`);
    console.log(`   ID:     ${usuarioId}`);
    console.log(`   Nombre: ${args.nombre}`);
    console.log(`   Usuario: ${args.usuario}`);
    console.log(`   Área:   ${areas[0].nombre} (ID: ${areaId})`);
    console.log(`   Rol:    ${args.rol}`);

  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

main()
  .catch((err) => {
    console.error('❌ Error inesperado:', err.message);
    process.exit(1);
  })
  .finally(() => process.exit(0));
