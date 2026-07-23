// scripts/migrar-usuario-login.js
// Uso: node scripts/migrar-usuario-login.js
// Pobla la columna `usuario` (ya agregada por la migración de Fase A)
// a partir del email actual, con dos overrides manuales por la colisión
// ya detectada y resuelta (ver public/panel/REDESIGN_USUARIO_LOGIN.md § Contexto).
//
// Este script NO borra la columna `email` — eso es la Fase C, manual,
// después de verificar que login funciona con `usuario`.

'use strict';

require('dotenv').config();
const db = require('../db');
const logger = require('../logger');

// Overrides manuales — únicos dos casos que colisionarían con la
// derivación automática (email.split('@')[0]).
const OVERRIDES = {
  314: 'sistemas.demo', // sistemas@demo.mvla.gob.ar (cuenta de seed/demo)
  319: 'sistemas',      // sistemas@mvla.local (cuenta real/activa)
};

function derivar(email) {
  return email.split('@')[0].trim().toLowerCase();
}

async function main() {
  const [usuarios] = await db.query('SELECT id, email FROM usuarios ORDER BY id');

  const mapeo = usuarios.map(u => ({
    id: u.id,
    email: u.email,
    usuario: OVERRIDES[u.id] || derivar(u.email),
  }));

  // Chequeo de duplicados ANTES de escribir nada — si algo cambió en la
  // base desde el análisis (nuevo usuario cargado), abortar en vez de
  // dejar que el UNIQUE de MySQL corte la migración a mitad de camino.
  const conteo = {};
  for (const u of mapeo) conteo[u.usuario] = (conteo[u.usuario] || 0) + 1;
  const duplicados = Object.entries(conteo).filter(([, n]) => n > 1);
  if (duplicados.length > 0) {
    console.error('Colisiones sin resolver, abortando:', duplicados);
    process.exit(1);
  }

  for (const u of mapeo) {
    await db.query('UPDATE usuarios SET usuario = ? WHERE id = ?', [u.usuario, u.id]);
    console.log(`  ${u.id}\t${u.email}\t->\t${u.usuario}`);
  }

  const [[{ sin_poblar }]] = await db.query(
    'SELECT COUNT(*) AS sin_poblar FROM usuarios WHERE usuario IS NULL'
  );
  console.log(`\nUsuarios sin poblar: ${sin_poblar} (debe ser 0)`);

  logger.info(`[migracion] usuario poblado para ${mapeo.length} usuarios`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
