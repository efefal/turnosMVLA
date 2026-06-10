// routes/auth.js — Autenticación del panel de empleados
//
// POST /panel/login  → valida email+password, devuelve JWT (8h)
// POST /panel/logout → registra logout en auditoría, el cliente borra el token
//
// Los empleados viven en la tabla `usuarios` con password_hash bcrypt.
// Un empleado puede pertenecer a varias áreas con distintos roles (usuario_areas).
// El campo `rol` del JWT toma el valor más alto: si es encargado en algún área → 'encargado'.

'use strict';

const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const pool   = require('../db');
const logger = require('../logger');
const { verificarJWT } = require('../middleware/auth');


// ─── POST /panel/login ────────────────────────────────────────────────────────
// Verifica credenciales y devuelve el JWT si son correctas.
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Faltan datos: se requieren email y password.' });
  }

  try {
    // Traer el usuario con sus áreas y roles en una sola consulta.
    // JSON_ARRAYAGG agrupa todas las filas de usuario_areas en un array JSON.
    // LEFT JOIN para que funcione aunque el usuario no tenga áreas asignadas todavía.
    const [rows] = await pool.query(`
      SELECT
        u.id,
        u.nombre,
        u.email,
        u.password_hash,
        u.activo,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'area_id',    ua.area_id,
            'area_nombre', a.nombre,
            'rol',        ua.rol
          )
        ) AS areas_json
      FROM usuarios u
      LEFT JOIN usuario_areas ua ON u.id = ua.usuario_id
      LEFT JOIN areas a          ON ua.area_id = a.id
      WHERE u.email = ?
      GROUP BY u.id
    `, [email]);

    if (rows.length === 0) {
      // No decimos si el email existe o no — siempre "credenciales incorrectas"
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const usuario = rows[0];

    if (!usuario.activo) {
      return res.status(401).json({
        error: 'Usuario inactivo. Contactá al administrador del sistema.'
      });
    }

    // bcrypt.compare() verifica el texto plano contra el hash almacenado.
    // Nunca comparamos passwords directamente — bcrypt incluye el salt en el hash.
    const passwordOk = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    // mysql2 puede devolver JSON_ARRAYAGG como array ya parseado o como string JSON,
    // dependiendo de la versión del driver. Normalizamos para manejar ambos casos.
    let areas = usuario.areas_json;
    if (typeof areas === 'string') areas = JSON.parse(areas);

    // Filtrar NULLs que aparecen si el LEFT JOIN no encontró filas (usuario sin áreas)
    areas = (areas || []).filter(a => a && a.area_id !== null);

    // Determinar el rol efectivo del usuario (orden de precedencia: sistemas > encargado > directivo > operador).
    // 'sistemas'  → acceso completo sin restricción de área (admins TI).
    // 'encargado' → gestión del área propia.
    // 'directivo' → acceso de solo lectura (sin modificaciones).
    // 'operador'  → operación de la propia agenda.
    const rol = areas.some(a => a.rol === 'sistemas')   ? 'sistemas'
              : areas.some(a => a.rol === 'encargado')  ? 'encargado'
              : areas.some(a => a.rol === 'directivo')  ? 'directivo'
              : 'operador';

    // Lista de IDs de áreas donde trabaja este usuario
    const areaIds = areas.map(a => a.area_id);

    // Payload del JWT. password_hash no va nunca en el token.
    // expiresIn 8h = una jornada laboral, el usuario tiene que loguearse cada día.
    const payload = { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol, areaIds };
    const token   = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });

    // Actualizar ultimo_acceso y registrar en auditoría en paralelo
    await Promise.all([
      pool.query('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?', [usuario.id]),
      pool.query(
        `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal, ip)
         VALUES (?, 'usuario', ?, 'login', ?, 'panel', ?)`,
        [
          usuario.id,
          usuario.id,
          JSON.stringify({ email: usuario.email }),
          req.ip || null,
        ]
      ),
    ]);

    logger.info(`[auth] Login exitoso — ${usuario.email} (ID ${usuario.id}, rol: ${rol})`);

    res.json({
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol, areaIds, areas },
    });

  } catch (err) {
    logger.error('[auth] Error en login:', err);
    res.status(500).json({ error: 'Error interno. Intentá de nuevo en unos minutos.' });
  }
});


// ─── POST /panel/logout ───────────────────────────────────────────────────────
// Requiere token válido para poder registrar el logout en auditoría.
// El cliente es el responsable de borrar el token del localStorage.
router.post('/logout', verificarJWT, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO auditoria (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal, ip)
       VALUES (?, 'usuario', ?, 'logout', NULL, 'panel', ?)`,
      [req.usuario.id, req.usuario.id, req.ip || null]
    );
    logger.info(`[auth] Logout — ${req.usuario.email} (ID ${req.usuario.id})`);
  } catch (err) {
    // Si falla la auditoría, igual respondemos OK — no queremos bloquear el logout
    logger.error('[auth] Error al registrar logout en auditoría:', err);
  }
  res.json({ ok: true });
});


module.exports = router;
