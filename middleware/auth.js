// middleware/auth.js — Verificación de autenticación para el panel de empleados
//
// Uso: aplicar como middleware en cualquier ruta del panel que requiera login.
//   router.get('/agenda', verificarJWT, handler)
//
// El token JWT viene en el header HTTP:
//   Authorization: Bearer <token>
//
// Si es válido, agrega req.usuario con el payload decodificado:
//   req.usuario.id      → ID del empleado en tabla usuarios
//   req.usuario.nombre  → Nombre completo
//   req.usuario.usuario → Nombre de usuario (login)
//   req.usuario.rol     → 'operador' o 'encargado' (el rol más alto del usuario)
//   req.usuario.areaIds → Array de IDs de áreas donde trabaja [1, 2, ...]
//
// Si el token es inválido, expirado o ausente, responde 401 y corta la cadena.

'use strict';

const jwt = require('jsonwebtoken');

function verificarJWT(req, res, next) {
  const authHeader = req.headers['authorization'];

  // El frontend envía el token en el header Authorization: Bearer <token>
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado. Iniciá sesión nuevamente.' });
  }

  // Quitar el prefijo "Bearer " (7 caracteres) para quedarnos con el token puro
  const token = authHeader.slice(7);

  try {
    // jwt.verify() valida la firma (con JWT_SECRET del .env) y que no haya expirado.
    // Si algo falla, lanza JsonWebTokenError o TokenExpiredError.
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado. Iniciá sesión nuevamente.' });
  }
}

module.exports = { verificarJWT };
