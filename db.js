// db.js — Módulo de conexión a la base de datos del motor propio
//
// Usa un pool de conexiones en lugar de una conexión única para que múltiples
// operaciones puedan ejecutarse en paralelo sin bloquearse entre sí.
// El pool crea y reutiliza conexiones automáticamente según la demanda.
//
// IMPORTANTE: para transacciones (crearCita) NO se puede usar pool.query() directamente
// porque la transacción necesita vivir en la misma conexión de principio a fin.
// En ese caso usar pool.getConnection() → connection.beginTransaction() → connection.release().

'use strict';

const mysql = require('mysql2/promise');
const logger = require('./logger');

// Leer las variables de entorno con prefijo MOTOR_
// Se cargan con dotenv en index.js antes de que cualquier módulo arranque,
// así que acá ya están disponibles en process.env.
const pool = mysql.createPool({
  host:     process.env.MOTOR_DB_HOST     || 'localhost',
  port:     parseInt(process.env.MOTOR_DB_PORT || '3306', 10),
  user:     process.env.MOTOR_DB_USER     || 'motor_user',
  password: process.env.MOTOR_DB_PASSWORD || '',
  database: process.env.MOTOR_DB_NAME     || 'motor_turnos',

  // Número máximo de conexiones abiertas al mismo tiempo.
  // 10 es más que suficiente para el volumen esperado del PoC.
  connectionLimit: 10,

  // Si se piden más conexiones que el límite, esperar hasta 10 segundos
  // antes de lanzar error. Evita rechazos inmediatos en picos cortos.
  waitForConnections: true,
  queueLimit: 0,

  // Reconectar automáticamente si la conexión se cae por inactividad
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,

  // mysql2 devuelve fechas y horas como strings, no como objetos Date de JS.
  // Esto facilita el manejo de fechas en formato "YYYY-MM-DD" y "HH:MM:SS"
  // sin conversiones inesperadas por zona horaria.
  dateStrings: true,
});

// Verificar la conexión al arrancar.
// Si las credenciales son incorrectas o MySQL no está corriendo,
// el error aparece en el log en lugar de fallar silenciosamente más tarde.
pool.getConnection()
  .then(connection => {
    logger.info('[db] Conexión al motor de base de datos establecida correctamente');
    // Devolver la conexión al pool — no la necesitamos acá, solo queríamos probar
    connection.release();
  })
  .catch(err => {
    // Loguear el error pero NO detener el proceso.
    // El sistema puede seguir funcionando con EA mientras el motor no esté listo.
    logger.error('[db] No se pudo conectar al motor de base de datos:', err.message);
  });

// Exportar el pool para que motor.js (y los scripts de admin) lo usen directamente.
// Ejemplo de uso en motor.js:
//   const db = require('./db');
//   const [rows] = await db.query('SELECT * FROM servicios WHERE activo = true');
module.exports = pool;
