# Plan — Reemplazo de `email` por `usuario` en autenticación del panel
# Decisión ya tomada: se elimina la columna `email` por completo (no queda
# como columna opcional). Sin librerías nuevas. Vanilla JS puro.
# No se toca lógica de negocio ajena a este cambio (roles, horarios, áreas).

---

## Contexto y decisión

El campo `email` de la tabla `usuarios` es heredado de Cal.com → Easy!Appointments
y nunca tuvo función real en el motor propio: no hay envío de correos ni reset
de clave por email (el reset lo hace `sistemas` manualmente desde el panel,
ver `POST /panel/usuarios/:id/resetear-clave`). Se reemplaza por un campo
`usuario` (nombre de usuario simple) que cumple la misma función de
identificador de login, sin las implicancias de formato/validación de un
email real.

**Fuera de alcance — no tocar:** el email ficticio de `vecinos`
(`dni_NUMERODNI@municipio.local`, usado en `motor.js`/`ea.js` vía
`obtenerCitasDelCliente(email)`) es un mecanismo completamente distinto,
para identificar **vecinos** ante Easy!Appointments — no tiene relación con
la tabla `usuarios` ni con el login del panel. No se modifica nada en
`motor.js`, `ea.js` ni en el flujo del bot de WhatsApp.

### Verificación de colisión ya realizada (sin tocar la base)

Se simuló la derivación `usuario = email.split('@')[0].trim().toLowerCase()`
contra los 18 usuarios reales de la tabla `usuarios`. Un solo conflicto:

| id | email | usuario derivado |
|---|---|---|
| 314 | sistemas@demo.mvla.gob.ar | ~~sistemas~~ → **`sistemas.demo`** (override) |
| 319 | sistemas@mvla.local | **`sistemas`** (cuenta real/activa, se queda con el nombre simple) |

El resto (16 de 18) usa la derivación automática sin ajuste. Mapeo completo
en la sección 3.

---

## 1. Esquema de base de datos

Estado actual (`DESCRIBE usuarios`, confirmado contra la base viva):

```
id                  int unsigned    PK auto_increment
nombre              varchar(150)    NOT NULL
email               varchar(255)    NOT NULL  UNIQUE
password_hash       varchar(255)    NOT NULL
activo              tinyint(1)      NOT NULL  default 1
ultimo_acceso       datetime        NULL
created_at          datetime        NOT NULL  default CURRENT_TIMESTAMP
debe_cambiar_clave  tinyint(1)      NOT NULL  default 0
```

`usuario` no colisiona con ninguna columna existente ni con palabras
reservadas de MySQL (a diferencia de `USER`, que sí lo es, `USUARIO` no).

### Migración en dos fases (para no romper nada a mitad de camino)

**Fase A — agregar columna nueva, nullable** (así el sistema sigue
funcionando con `email` sin cambios mientras se puebla el dato):

```sql
ALTER TABLE usuarios
  ADD COLUMN usuario VARCHAR(50) NULL UNIQUE AFTER email;
```

`UNIQUE` admite múltiples `NULL` en MySQL, así que esto no falla aunque la
columna esté vacía todavía.

**Fase B — backfill de datos** (script Node, ver sección 3) que hace
`UPDATE usuarios SET usuario = ? WHERE id = ?` fila por fila con el mapeo
ya confirmado.

**Verificación post-backfill (obligatoria antes de seguir):**

```sql
SELECT COUNT(*) AS sin_poblar FROM usuarios WHERE usuario IS NULL;
-- debe dar 0

SELECT usuario, COUNT(*) AS cant FROM usuarios GROUP BY usuario HAVING cant > 1;
-- debe devolver 0 filas (la restricción UNIQUE ya lo garantiza, pero se
-- verifica explícitamente antes de continuar)
```

**Fase C — endurecer + eliminar `email`** (solo después de que el backend
y el frontend ya estén migrados y probados en Pasos 2-3, no antes):

```sql
ALTER TABLE usuarios MODIFY usuario VARCHAR(50) NOT NULL;
ALTER TABLE usuarios DROP COLUMN email;
```

> **Corrección detectada durante el Paso 2 (no prevista originalmente):**
> `email` seguía siendo `NOT NULL` sin default. El alta de usuario
> (`INSERT INTO usuarios (nombre, usuario, password_hash, debe_cambiar_clave)
> VALUES (...)`, que ya no incluye `email`) fallaba con
> `Field 'email' doesn't have a default value`. Se aplicó, con
> confirmación explícita, un `ALTER TABLE usuarios MODIFY email
> VARCHAR(255) NULL;` — **no** se tocó el contenido ni se eliminó la
> columna, solo se relajó la restricción para no bloquear altas nuevas
> mientras `email` sigue existiendo hasta la Fase C real.

---

## 2. Reglas de validación de `usuario`

- Longitud: 3 a 50 caracteres.
- Caracteres permitidos: minúsculas, números, punto, guion bajo.
- Debe empezar con letra o número (no con `.` ni `_`).
- Se normaliza a lowercase y se hace `trim()` antes de guardar (igual que
  hoy con email).
- `UNIQUE` a nivel de base (ya cubierto por la columna).

Regex: `/^[a-z0-9][a-z0-9._]{2,49}$/`

Se centraliza como constante en `routes/panel.js` (reutilizada en el alta
de usuario) — no hace falta un módulo nuevo, es una sola validación en un
solo endpoint de creación (el `PATCH` de edición no permite tocar el
usuario de login, igual que hoy no permite tocar el email — ver punto 5).

---

## 3. Mapeo de datos confirmado (18 usuarios)

Script de backfill `scripts/migrar-usuario-login.js` (nuevo, de un solo uso
— se puede borrar después de correrlo, o dejarlo documentado como
histórico igual que otros scripts de `admin/`):

```javascript
// scripts/migrar-usuario-login.js
// Uso: node scripts/migrar-usuario-login.js
// Pobla la columna `usuario` (ya agregada por la migración de Fase A)
// a partir del email actual, con dos overrides manuales por la colisión
// ya detectada y resuelta (ver REDESIGN_USUARIO_LOGIN.md § Contexto).
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
```

Mapeo completo que aplica el script (para revisión antes de correrlo):

| id | email | usuario |
|---|---|---|
| 302 | sofia.romero@mvla.gob.ar | sofia.romero |
| 303 | carlos.mendez@mvla.gob.ar | carlos.mendez |
| 304 | laura.vidal@mvla.gob.ar | laura.vidal |
| 305 | test.encargado@panel.local | test.encargado |
| 306 | admin@prueba.com | admin |
| 307 | op1.lic@demo.mvla.gob.ar | op1.lic |
| 308 | op2.lic@demo.mvla.gob.ar | op2.lic |
| 309 | op3.lic@demo.mvla.gob.ar | op3.lic |
| 310 | op1.trib@demo.mvla.gob.ar | op1.trib |
| 311 | op2.trib@demo.mvla.gob.ar | op2.trib |
| 312 | enc.lic@demo.mvla.gob.ar | enc.lic |
| 313 | enc.trib@demo.mvla.gob.ar | enc.trib |
| **314** | sistemas@demo.mvla.gob.ar | **sistemas.demo** (override) |
| 315 | franquito@mvla.gob.ar | franquito |
| 316 | pierre@mvla.gob.ar | pierre |
| 317 | directiva@demo.mvla.gob.ar | directiva |
| 318 | fermin@demomvla.gob.ar | fermin |
| **319** | sistemas@mvla.local | **sistemas** (override) |

Los 18 valores derivados cumplen la regex de validación de la sección 2
(todos entre 3-50 caracteres, empiezan con letra, solo `[a-z0-9._]`) — no
hace falta ajuste adicional más allá de los dos overrides ya definidos.

---

## 4. Backend — cambios archivo por archivo

### `routes/auth.js`

- `POST /login`: recibe `{ usuario, password }` en vez de `{ email, password }`.
- Query: `WHERE u.email = ?` → `WHERE u.usuario = ?`.
- SELECT: traer `u.usuario` en reemplazo directo de `u.email` — **el SELECT no vuelve a mencionar `u.email` desde este commit**, aunque la columna siga existiendo en la tabla hasta la Fase C. No se mantiene "por las dudas" durante la transición (ajuste confirmado antes de ejecutar).
- Payload del JWT: `{ id, nombre, email, rol, areaIds }` → `{ id, nombre, usuario, rol, areaIds }` (línea ~98).
- Auditoría de login: `JSON.stringify({ email: usuario.email })` → `JSON.stringify({ usuario: usuario.usuario })` (línea ~110).
- Log: `logger.info(\`[auth] Login exitoso — ${usuario.email} ...\`)` → `usuario.usuario` (línea ~116).
- Respuesta al cliente: `usuario: { id, nombre, email, rol, areaIds, areas }` → reemplazar `email` por `usuario` (línea ~122).
- `POST /logout`: `logger.info(\`[auth] Logout — ${req.usuario.email} ...\`)` → `req.usuario.usuario` (línea ~145).

### `middleware/auth.js`

- Actualizar el comentario de cabecera: `req.usuario.email → Email` pasa a `req.usuario.usuario → Nombre de usuario` (línea ~12). Es solo documentación, no hay lógica que tocar acá — el middleware ya reenvía el payload completo del JWT tal cual venga.

### `routes/panel.js`

- **Alta de usuario** (`POST /panel/usuarios`, línea ~1808-1862):
  - `const { nombre, email, password, rol } = req.body;` → `const { nombre, usuario, password, rol } = req.body;`
  - Validación de obligatorios: `!nombre || !email || ...` → `!nombre || !usuario || ...`
  - Agregar validación de formato (regex de sección 2) devolviendo 400 con mensaje claro si no cumple.
  - `SELECT id FROM usuarios WHERE email = ?` → `WHERE usuario = ?`; mensaje de error `'Ya existe un usuario con ese email.'` → `'Ya existe un usuario con ese nombre de usuario.'`
  - `INSERT INTO usuarios (nombre, email, password_hash, debe_cambiar_clave) VALUES (?, ?, ?, 1)` → columna `usuario` en vez de `email`; `email.trim().toLowerCase()` → `usuario.trim().toLowerCase()`.
  - Auditoría y log: `{ nombre, email, rol, ... }` → `{ nombre, usuario, rol, ... }`; `(${email}) creado por` → `(${usuario}) creado por`.
- **Listado de usuarios** (`GET /panel/usuarios`, líneas ~1749 y ~1766): `u.email` → `u.usuario` en ambos SELECT (rama sistemas y rama encargado); el `.map()` de salida (línea ~1790) cambia `email: u.email` → `usuario: u.usuario`.
- **Dropdown de filtro de auditoría** (`GET /panel/auditoria/usuarios`, líneas ~1595 y ~1600): `SELECT id, nombre, email` → `SELECT id, nombre, usuario` en ambas variantes de query (sistemas / encargado).
- **Join de auditoría** (`GET /panel/auditoria`, línea ~1543): `u.email AS usuario_email` → `u.usuario AS usuario_login`. Verificado: `auditoria.html` no lee `usuario_email` en ningún lado, solo usa `usuario_nombre` (auditoria.html:701) para mostrar quién hizo la acción — el rename de alias es seguro, no rompe el render de esa página.
- **Reset de contraseña** (`POST /panel/usuarios/:id/resetear-clave`, línea ~2366): `SELECT id, nombre, email FROM usuarios` → `SELECT id, nombre, usuario FROM usuarios`; log línea ~2391 `(${rows[0].email})` → `(${rows[0].usuario})`.
- **`PATCH /panel/usuarios/:id`**: sin cambios funcionales — hoy no permite editar `email` y no va a permitir editar `usuario` tampoco (mismo comportamiento heredado, no es una decisión nueva de este cambio). Si en el futuro se quiere permitir editar el nombre de usuario, es un endpoint nuevo a pedir explícitamente.

---

## 5. Frontend — cambios archivo por archivo

### `public/panel/login.html`

- Input: `<input type="email" id="email" autocomplete="email" placeholder="nombre@municipio.gob.ar" required>` (línea ~172) → `<input type="text" id="usuario" autocomplete="username" placeholder="nombre.apellido" required>`.
- Label: `<label for="email">Correo electrónico</label>` → `<label for="usuario">Usuario</label>`.
- CSS: los tres selectores `input[type="email"]` (líneas ~76, ~88, ~93) → `input[type="text"]` (quedan agrupados con `input[type="password"]` igual que ahora, mismo bloque de reglas).
- JS: `const email = document.getElementById('email').value.trim();` → `const usuario = document.getElementById('usuario').value.trim();`; el body del fetch `{ email, password }` → `{ usuario, password }`.

### `public/panel/usuarios.html`

- Columna de tabla: `<th>Email</th>` (línea ~323) → `<th>Usuario</th>`.
- Input de alta: `<input type="email" id="nuevo-email" placeholder="ejemplo@municipio.gov.ar">` (línea ~349) → `<input type="text" id="nuevo-usuario" placeholder="nombre.apellido">`; label `Email (para iniciar sesión)` → `Usuario (para iniciar sesión)`.
- Render de tabla: `<td class="text-secondary">${esc(u.email)}</td>` (línea ~651) → `${esc(u.usuario)}`.
- JS de alta (`crearUsuario()`, líneas ~808-836): `const email = document.getElementById('nuevo-email').value.trim();` → `const usuario = document.getElementById('nuevo-usuario').value.trim();`; validación `!nombre || !email || ...` → `!nombre || !usuario || ...`; body del fetch `{ nombre, email, password, rol, areas, atiendeAreas }` → `{ nombre, usuario, password, rol, areas, atiendeAreas }`; limpieza de formulario `document.getElementById('nuevo-email').value = ''` → `nuevo-usuario`.
- El modal de edición no tiene campo de email hoy y sigue sin tenerlo (ver punto 5 del backend) — sin cambios ahí.

---

## 6. Scripts de administración (fuera del panel web, mismo flujo)

### `admin/crear-usuario.js`

- Flag CLI `--email` → `--usuario` (comentarios de cabecera líneas ~4, ~9, ~25, ~43, ~47).
- `obligatorios = ['nombre', 'email', 'password', 'area', 'rol']` → reemplazar `'email'` por `'usuario'`.
- `SELECT id FROM usuarios WHERE email = ?` → `WHERE usuario = ?`.
- `INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)` → columna `usuario`.
- Auditoría y output de consola (`Email: ...`) → `Usuario: ...`.

### `scripts/seed-demo.js`

- El array `USUARIOS_DEMO` reemplaza la key `email` por `usuario`, usando los mismos valores ya migrados en la tabla real (ej. `op1.lic`, `enc.lic`, `sistemas.demo` para el usuario de seed que coincide con el id 314 ya migrado — mantener coherencia con el mapeo de la sección 3 para no generar un usuario duplicado si el seed se vuelve a correr).
- Queries de idempotencia (`SELECT id FROM usuarios WHERE email = ?`, `WHERE email IN (...)`) → `usuario`.

### `test-panel.js`

- Variables de entorno `TEST_EMAIL`/`TEST_PASSWORD` → `TEST_USUARIO`/`TEST_PASSWORD` (o se mantiene `TEST_PASSWORD` sin cambios y solo se renombra la de usuario).
- `req('POST', '/login', { email: ..., password: ... }, ...)` → `{ usuario: ..., password: ... }` en los dos usos (login con credenciales inexistentes y login real).
- Mensajes de consola que mencionan `TEST_EMAIL` → `TEST_USUARIO`.

---

## 7. Orden de implementación con checkpoints

Principio general: en ningún punto intermedio el login debe quedar roto.
Backend y frontend del cutover (Paso 2) se prueban juntos antes de commitear
porque son interdependientes — un deploy parcial de uno sin el otro rompe
el login por completo (a diferencia de los rediseños visuales, acá no hay
forma de que convivan una versión vieja y una nueva del contrato de login).

### Paso 1 — Migración de esquema + backfill (sin tocar backend/frontend todavía)

1. Ejecutar Fase A (`ALTER TABLE ... ADD COLUMN usuario ...`).
2. Crear y correr `scripts/migrar-usuario-login.js`.
3. Verificación manual (obligatoria antes de avanzar):
   - `SELECT COUNT(*) FROM usuarios WHERE usuario IS NULL` → 0
   - `SELECT usuario, COUNT(*) FROM usuarios GROUP BY usuario HAVING COUNT(*) > 1` → 0 filas
   - `SELECT id, email, usuario FROM usuarios ORDER BY id` → comparar visualmente contra la tabla de la sección 3
4. En este punto el sistema sigue funcionando 100% igual que antes (login sigue usando `email`, columna `usuario` existe pero nadie la lee todavía).
5. Commit: `feat(db): agregar columna usuario y poblarla desde email (migración)`.

### Paso 2 — Cutover de backend + frontend (login, JWT, alta de usuario, lecturas)

1. Aplicar todos los cambios de la sección 4 (`routes/auth.js`, `middleware/auth.js`, `routes/panel.js`).
2. Aplicar todos los cambios de la sección 5 (`login.html`, `usuarios.html`).
3. Reiniciar el servidor local y probar manualmente:
   - Si no se dispone de la contraseña real de un usuario migrado, usar primero `POST /panel/usuarios/:id/resetear-clave` (rol sistemas, mecanismo ya existente) para fijar una clave de prueba conocida — no asumir que la contraseña está disponible.
   - Login con ese usuario migrado (ej. `sofia.romero` / la clave temporal recién generada) → JWT recibido, `usuario.usuario` presente, sin `email` en la respuesta.
   - Login con credenciales incorrectas → sigue devolviendo 401 genérico.
   - Alta de usuario nuevo desde `usuarios.html` con un `usuario` válido → se crea correctamente.
   - Alta con `usuario` inválido (mayúsculas, empieza con punto, muy corto) → 400 con mensaje claro.
   - Alta con `usuario` duplicado → 409.
   - Tabla de `usuarios.html` muestra la columna "Usuario" con los valores migrados.
   - Reset de contraseña sigue funcionando (rol sistemas).
   - `auditoria.html`: el filtro por usuario y el detalle de cada registro siguen mostrando el nombre correctamente (ya confirmado que solo depende de `usuario_nombre`, no de `usuario_email`).
4. Commit: `feat(auth): reemplazar email por usuario en login del panel`.

### Paso 3 — Scripts de administración

1. Aplicar los cambios de la sección 6.
2. Probar `admin/crear-usuario.js --usuario ... ` manualmente contra la base de desarrollo (o revisar el código sin ejecutar si no se quiere crear un usuario de prueba adicional).
3. Commit: `chore(admin): actualizar scripts de administración a usuario en vez de email`.

### Paso 4 — Endurecer esquema y eliminar `email` (solo tras verificar Pasos 2-3 en uso real, no inmediatamente después)

1. Confirmar que no queda ninguna referencia activa a `u.email`/`usuarios.email` en el código (grep de cierre, ver checklist below).
2. Ejecutar Fase C (`MODIFY usuario NOT NULL` + `DROP COLUMN email`).
3. Verificación: login sigue funcionando, alta de usuario sigue funcionando, no hay errores de columna faltante en los logs.
4. Commit: `feat(db): eliminar columna email de usuarios (migración completa a usuario)`.

---

## 8. Checklist de cierre (antes del Paso 4)

- [ ] `grep -rn "\.email" routes/ middleware/ admin/ scripts/` → 0 resultados relacionados a `usuarios.email` (las referencias a `vecinos`/`motor.js`/`ea.js` quedan, son del mecanismo de vecinos, fuera de alcance)
- [ ] `grep -rn "email" public/panel/login.html public/panel/usuarios.html` → 0 resultados
- [ ] JWT payload no incluye `email` en ningún login de prueba
- [ ] Los 18 usuarios reales pueden loguearse con su `usuario` migrado (o al menos una muestra representativa de cada rol: operador, encargado, directivo, sistemas)
- [ ] `usuarios.html`, `auditoria.html`, reset de contraseña probados manualmente en el navegador

---

## Próximos pasos (para actualizar en CLAUDE.md al terminar)

- [ ] Paso 1 — migración de esquema + backfill
- [ ] Paso 2 — cutover backend + frontend
- [ ] Paso 3 — scripts de administración
- [ ] Paso 4 — endurecer esquema, DROP email
