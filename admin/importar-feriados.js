// admin/importar-feriados.js — Importa feriados nacionales desde api.argentinadatos.com
//
// USO:
//   node admin/importar-feriados.js --año 2026
//
// ARGUMENTOS:
//   --año   Año a importar (obligatorio, ej: 2026)
//
// FUENTE: https://api.argentinadatos.com/v1/feriados/{año}
//
// La API devuelve un array de objetos con esta forma:
//   { fecha: "2026-01-01", tipo: "inamovible", nombre: "Año Nuevo" }
//
// COMPORTAMIENTO:
//   - Inserta cada feriado con tipo='nacional' en la tabla feriados.
//   - Si un feriado ya existe (restricción UNIQUE en columna fecha), lo saltea sin error.
//   - Al final, registra UNA sola entrada en auditoría con la cantidad importada.
//
// NOTA SOBRE FERIADOS LOCALES:
//   Los feriados propios del municipio (ej: Aniversario de Villa La Angostura)
//   se cargan directamente con SQL porque son excepcionales. Este script solo
//   maneja los nacionales.

'use strict';

require('dotenv').config();

const https = require('https');
const db    = require('../db');

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
  node admin/importar-feriados.js --año YYYY

EJEMPLOS:
  node admin/importar-feriados.js --año 2026
  node admin/importar-feriados.js --año 2027
`);
}

// Hace una petición HTTPS y devuelve el body como string.
// Node.js tiene módulo https nativo — no necesitamos axios ni node-fetch para esto.
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Seguir redirecciones manualmente si la API devuelve 301/302
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`La API respondió con HTTP ${res.statusCode}`));
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end',  ()      => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('La respuesta de la API no es JSON válido'));
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  const args = parsearArgs();

  if (!args.año) {
    console.error('❌ Falta el argumento --año');
    mostrarUso();
    process.exit(1);
  }

  const año = parseInt(args.año, 10);
  if (isNaN(año) || año < 2000 || año > 2100) {
    console.error(`❌ --año debe ser un año válido (2000-2100), recibido: "${args.año}"`);
    process.exit(1);
  }

  const url = `https://api.argentinadatos.com/v1/feriados/${año}`;
  console.log(`📡 Consultando: ${url}`);

  let feriados;
  try {
    feriados = await fetchJSON(url);
  } catch (err) {
    console.error(`❌ Error al consultar la API: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(feriados) || feriados.length === 0) {
    console.error(`❌ La API no devolvió feriados para el año ${año}`);
    process.exit(1);
  }

  console.log(`📋 Feriados recibidos de la API: ${feriados.length}`);

  let insertados = 0;
  let salteados  = 0;

  for (const feriado of feriados) {
    // La API devuelve { fecha, tipo, nombre }
    // tipo puede ser: "inamovible", "trasladable", "puente", etc.
    // Todos los guardamos como tipo='nacional' en nuestra tabla.
    if (!feriado.fecha || !feriado.nombre) {
      console.warn(`⚠️  Feriado sin fecha o nombre, salteando:`, feriado);
      salteados++;
      continue;
    }

    try {
      await db.query(
        `INSERT INTO feriados (fecha, descripcion, tipo)
         VALUES (?, ?, 'nacional')`,
        [feriado.fecha, feriado.nombre]
      );
      console.log(`   ✅ ${feriado.fecha} — ${feriado.nombre}`);
      insertados++;
    } catch (err) {
      // El código ER_DUP_ENTRY indica violación de la restricción UNIQUE.
      // Significa que ese feriado ya existe → lo salteamos sin error.
      if (err.code === 'ER_DUP_ENTRY') {
        console.log(`   ⏭️  ${feriado.fecha} — ${feriado.nombre} (ya existía)`);
        salteados++;
      } else {
        // Cualquier otro error sí es inesperado y lo propagamos
        throw err;
      }
    }
  }

  // Registrar en auditoría una sola entrada con el resumen de la importación
  await db.query(
    `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal)
     VALUES (NULL, 'feriado', 0, 'crear', ?, 'sistema')`,
    [
      JSON.stringify({ año, insertados, salteados, fuente: url }),
    ]
  );

  console.log(`\n✅ Importación completada:`);
  console.log(`   Año:        ${año}`);
  console.log(`   Insertados: ${insertados}`);
  console.log(`   Salteados:  ${salteados} (ya existían)`);
  console.log(`   Total API:  ${feriados.length}`);
}

main()
  .catch((err) => {
    console.error('❌ Error inesperado:', err.message);
    process.exit(1);
  })
  .finally(() => process.exit(0));
