# Plan — nueva pantalla areas.html (ABM de áreas, rol sistemas)
# Referencia principal: servicios-admin.html (ABM más similar en complejidad)
# Referencia secundaria: usuarios.html (control de acceso por rol)
# Restricciones: Vanilla JS · sin frameworks · solo vars de design-tokens.css

---

## Contexto

`areas.html` es una pantalla **nueva** (no una migración), exclusiva del rol
`sistemas`. Es el ABM más simple de los cuatro que tiene el panel (usuarios,
servicios, bloqueos, y ahora áreas): una tabla + un formulario de alta + un
modal de edición, sin B2/B3 (checkboxes de área — no aplica, el área *es* la
entidad), sin B4 (horarios), sin reset de clave, sin B9 (chips de filtro por
área — no aplica, la propia tabla ya lista las áreas).

Al ser de acceso exclusivo `sistemas`, es la única de las 8 pantallas con
sidebar que se oculta también para `encargado` y `directivo` (que sí ven
Usuarios/Servicios como solo-lectura o gestión parcial).

---

## 1. Inventario de IDs obligatorios

### Sidebar (idéntico a las otras 7 páginas + `nav-areas` nuevo)

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `nav-nombre` | `init()` | inyecta `nombre + rolBadgeHTML()` |
| `sidebar-avatar` | `init()` | iniciales + color según rol |
| `label-reportes` | `init()` | muestra label "Reportes" |
| `label-admin` | `init()` | muestra label "Admin." |
| `nav-auditoria` | `init()` | `style.display = ''` |
| `nav-dashboard` | `init()` | `style.display = ''` |
| `nav-usuarios` | `init()` | `style.display = ''` |
| `nav-servicios` | `init()` | `style.display = ''` |
| `nav-areas` **(nuevo)** | `init()` — **solo si `rol === 'sistemas'`** | `style.display = ''` |

> En `areas.html`, el link "Áreas" es `.nav-item.active` hardcodeado (sin
> ID, siempre visible ahí, igual que "Servicios" en servicios-admin.html).
> `nav-areas` como ID solo existe en las **otras** páginas.

### Tabla / alertas de lista

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `error-lista` | `mostrarAlerta()` | toggle `.visible` + textContent |
| `ok-lista` | `mostrarAlerta()` | toggle `.visible` + textContent + auto-hide 4s |
| `tbody-areas` | `renderAreas()`, `cargarAreas()` | `.innerHTML` con filas |

### Formulario nueva área

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `nuevo-nombre` | `crearArea()` | `.value` leído |
| `nuevo-descripcion` | `crearArea()` | `.value` leído |
| `error-form` | `mostrarAlerta()` | toggle `.visible` |

> No hay `card-nuevo-area` con `style.display='none'` condicional por rol —
> la página entera ya es exclusiva de `sistemas`, no hace falta ocultar el
> formulario para un sub-rol de solo lectura como en servicios/usuarios.

### Modal de edición

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `modal-fondo` | `abrirModal()`, `cerrarModal()`, `init()` | toggle clase `.abierto` |
| `error-modal` | `mostrarAlertaModal()` | toggle `.visible` |
| `edit-nombre` | `abrirModal()`, `guardarEdicion()` | `.value` |
| `edit-descripcion` | `abrirModal()`, `guardarEdicion()` | `.value` |
| `edit-activo` | `abrirModal()`, `guardarEdicion()` | `.value` (`'1'`/`'0'`) |

---

## 2. Endpoints necesarios

### 2.1 — GET /panel/areas (EXISTENTE — no se toca)

Confirmado en el análisis (línea 2335 de `routes/panel.js`): ya es usado hoy
por los chips B9 de `agenda.html`, `bloqueos.html`, `servicios-admin.html` y
`usuarios.html`. Devuelve solo `{id, nombre}` de áreas **activas**,
filtradas por rol.

**No se modifica el comportamiento ni el shape de respuesta de este
endpoint.** Cualquier cambio ahí podría romper los 4 selectores de área que
ya dependen de él. `areas.html` **no lo usa** — necesita más campos
(`descripcion`, `activo`, conteos) y también las áreas inactivas, que este
endpoint nunca devuelve.

### 2.2 — GET /panel/areas/admin (NUEVO)

Endpoint separado, exclusivo para la vista de administración. Mismo patrón
que `GET /panel/servicios/admin` (línea 2012).

```javascript
router.get('/areas/admin', async (req, res) => {
  if (!esSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol sistemas.' });
  }
  try {
    const [areas] = await pool.query(`
      SELECT
        a.id, a.nombre, a.descripcion, a.activo, a.created_at,
        (SELECT COUNT(*) FROM servicios s WHERE s.area_id = a.id AND s.activo = TRUE) AS servicios_activos,
        (SELECT COUNT(*) FROM usuario_areas ua WHERE ua.area_id = a.id) AS usuarios_asignados
      FROM areas a
      ORDER BY a.nombre ASC
    `);
    res.json(areas);
  } catch (err) {
    logger.error('[panel] Error al obtener áreas (admin):', err);
    res.status(500).json({ error: 'No se pudieron obtener las áreas.' });
  }
});
```

Devuelve **todas** las áreas (activas e inactivas), con conteos para que la
tabla muestre de un vistazo cuántos servicios/usuarios dependen de cada una
— esto es lo que informa la decisión de desactivar (ver §3).

### 2.3 — POST /panel/areas (NUEVO)

```javascript
router.post('/areas', async (req, res) => {
  if (!esSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol sistemas.' });
  }
  const { nombre, descripcion } = req.body;
  if (!nombre) {
    return res.status(400).json({ error: 'El nombre es obligatorio.' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO areas (nombre, descripcion) VALUES (?, ?)',
      [nombre.trim(), descripcion?.trim() || null]
    );
    await auditar(req.usuario.id, 'area', result.insertId, 'crear',
      { nombre, descripcion, creado_por: req.usuario.nombre }, req.ip);
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    logger.error('[panel] Error al crear área:', err);
    res.status(500).json({ error: 'No se pudo crear el área.' });
  }
});
```

### 2.4 — PATCH /panel/areas/:id (NUEVO)

```javascript
router.patch('/areas/:id', async (req, res) => {
  if (!esSistemas(req)) {
    return res.status(403).json({ error: 'Sin permiso. Se requiere rol sistemas.' });
  }
  const id = parseInt(req.params.id, 10);
  const { nombre, descripcion, activo } = req.body;
  if (nombre === undefined && descripcion === undefined && activo === undefined) {
    return res.status(400).json({ error: 'Se requiere al menos un campo para actualizar.' });
  }
  try {
    const [rows] = await pool.query('SELECT id FROM areas WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Área no encontrada.' });
    }
    const sets = [], valores = [];
    if (nombre !== undefined)      { sets.push('nombre = ?');      valores.push(nombre.trim()); }
    if (descripcion !== undefined) { sets.push('descripcion = ?'); valores.push(descripcion?.trim() || null); }
    if (activo !== undefined)      { sets.push('activo = ?');      valores.push(activo ? 1 : 0); }
    valores.push(id);

    await pool.query(`UPDATE areas SET ${sets.join(', ')} WHERE id = ?`, valores);
    await auditar(req.usuario.id, 'area', id, 'modificar',
      { nombre, descripcion, activo, modificado_por: req.usuario.nombre }, req.ip);
    res.json({ ok: true });
  } catch (err) {
    logger.error('[panel] Error al editar área:', err);
    res.status(500).json({ error: 'No se pudo modificar el área.' });
  }
});
```

**No hay `DELETE /panel/areas/:id`.** Ver §3 para la justificación completa
— se sigue el mismo patrón de soft-delete que servicios y usuarios.

---

## 3. Integridad referencial al desactivar un área

### Lo que confirmé en el análisis

- Las 3 FKs que apuntan a `areas.id` (`servicios.area_id`,
  `usuario_areas.area_id`, `bloqueos.area_id`) tienen `DELETE_RULE = NO
  ACTION`. Un `DELETE` real sobre un área con filas asociadas en cualquiera
  de esas 3 tablas falla en la base con error de constraint. Por eso **no
  se implementa DELETE** — ni falta, ni sería seguro exponerlo sin manejar
  ese error en cada caso.

- Precedente en `servicios-admin.html`: `PATCH /panel/servicios/:id` con
  `{activo: false}` **no bloquea ni advierte** si el servicio tiene turnos
  futuros — el toggle es incondicional y silencioso. No hay chequeo de
  `turnos` en ese endpoint.

- **Diferencia real con servicios:** desactivar un *servicio* sí tiene
  efecto inmediato en el flujo de reserva — `motor.js` → `obtenerServicios()`
  filtra por `servicios.activo = TRUE`, así que un servicio inactivo
  desaparece al instante del bot y del selector web.

  Desactivar un *área*, en cambio, **no tiene ese mismo efecto en cascada**.
  Confirmé en `motor.js` que ninguna de las funciones del motor
  (`obtenerServicios`, `obtenerProveedores`, `obtenerDisponibilidad*`,
  `crearCita`/`tomarTurno`) hace JOIN contra `areas.activo`. Solo filtran
  por `servicios.activo`. Es decir: **si desactivás un área que todavía
  tiene servicios activos, esos servicios siguen siendo reservables por
  WhatsApp y por la web** — el campo `areas.activo` solo afecta:
  1. Qué áreas devuelve `GET /panel/areas` (los chips B9 del panel).
  2. Qué áreas devuelve el nuevo `GET /panel/areas/admin` (aparece igual,
     pero marcada como inactiva).

  No oculta servicios, no cancela turnos, no afecta `usuario_areas`.

### Decisión propuesta

Mantener la misma filosofía que servicios-admin.html — **no bloquear la
desactivación** (evita validación defensiva que el resto del panel no
tiene, y el usuario sistemas es el rol de máximo privilegio, se asume que
sabe lo que hace). Pero, a diferencia de servicios, acá el efecto real es
menos obvio (no hay ocultamiento en cascada), así que:

- El `PATCH` no bloquea ni valida — igual que servicios.
- La tabla de `areas.html` muestra las columnas `servicios_activos` y
  `usuarios_asignados` (ya vienen del `GET /panel/areas/admin`, §2.2) de
  forma permanente, no solo al intentar desactivar — así el dato de "esto
  tiene 2 servicios activos" está siempre a la vista antes de tocar el
  botón.
- El botón "Desactivar" en la fila, cuando `servicios_activos > 0` **o**
  `usuarios_asignados > 0`, muestra un `confirm()` nativo del navegador con
  el detalle de ambos conteos (el que aplique) antes de llamar al PATCH —
  **solo eso, sin bloquear la operación.** Un área puede tener usuarios
  asignados sin tener servicios activos (caso posible aunque no esté en los
  datos actuales), y esos usuarios quedan con un rol asignado a un área
  marcada inactiva en el panel sin que se les revoque el acceso
  automáticamente — merece el mismo aviso.

  Mensaje cuando ambos conteos son > 0:
  > ¿Desactivar "Licencias de Conducir"? Tiene 2 servicios activos que
  > seguirán siendo reservables, y 13 usuarios con este rol asignado —
  > desactivalos manualmente si querés ocultar los servicios del bot y la
  > web.

  El texto se arma condicionalmente por partes (solo servicios, solo
  usuarios, o ambos) — nunca menciona un conteo en cero. Si ambos conteos
  son 0, desactiva directo sin `confirm()` (igual que el toggle de
  servicios).

Esto es una capa mínima de aviso (no defensiva, no bloqueante, no nueva
lógica de servidor) que compensa que el efecto de desactivar un área es
menos intuitivo que el de desactivar un servicio.

---

## 4. Clases CSS a reutilizar de design-tokens.css / servicios-admin.html

Prácticamente todo sale de las clases locales ya usadas en
`servicios-admin.html` (que a su vez son 100% tokens). Sin CSS nuevo más
allá de renombrar contextos:

- Layout: `.app-shell`, `.main-content`, `.page-inner`, `.page-supertitle`, `.page-title`
- Sidebar: `.sidebar`, `.sidebar-header`, `.sidebar-logo`, `.sidebar-muni`, `.sidebar-ciudad`, `.sidebar-user-card`, `.sidebar-avatar`, `.nav-section-label`, `.sidebar-nav`, `.sidebar-footer`, `.btn-logout-sidebar`
- Card: `.card`, `.card-titulo`
- Botones: `.btn`, `.btn-primary`, `.btn-secondary` (tokens), `.btn-ghost`, `.btn-warning`, `.btn-sm` (locales, igual que servicios-admin.html)
- Alertas: `.alerta`, `.alerta.visible`, `.alerta-error`, `.alerta-ok`
- Tabla: `.tabla-wrapper`, `table`/`th`/`td`, `.td-acciones`
- Badges: `.badge`, `.badge-activo`, `.badge-inactivo` (estado del área — mismo patrón que servicios)
- Formulario: `.form-grid`, `.form-grupo`, `.form-grupo.full`, `.req`, `.form-hint`, `.form-pie`
- Modal: `.modal-fondo`, `.modal-fondo.abierto`, `.modal-caja`, `.modal-footer`
- Misc: `.cargando`, `.vacio`

**No se necesita:** `.area-selector`/`.area-chips` (B9 — no aplica acá, la
tabla ya es la lista de áreas), `.area-check-*` (B2/B3 — no aplica),
`.horarios-*` (B4 — no aplica), `#reset-clave-display` (no aplica).

Única columna nueva de tabla sin precedente exacto: `servicios_activos` /
`usuarios_asignados` como números simples en `<td>`, sin badge — no
necesitan clase propia.

---

## 5. Exclusiones — inline styles / clases generadas por JS que no se tocan

Siguiendo el mismo criterio que los rediseños anteriores, documento acá lo
que **no** se puede modificar sin tocar lógica JS, y lo que se decide
**no replicar** de los archivos de referencia:

### 5.1 — Precedente encontrado en servicios-admin.html y usuarios.html (NO se replica)

Ambos archivos de referencia tienen colores hex hardcodeados dentro de
template strings de JS (no en el `<style>`, sino generados en runtime):

```javascript
// servicios-admin.html — renderServicios()
<td style="color:#64748b">...
'<span style="color:#94a3b8">Sin mensaje</span>'
'<span style="color:#94a3b8;font-size:.78rem">Solo lectura</span>'

// usuarios.html — renderUsuarios() / construirAreaCheckboxes() / cargarHorarios()
<td style="color:#64748b">...
'<span style="color:#94a3b8;font-size:.78rem">Sin permiso</span>'
'<span style="color:#94a3b8;font-size:.85rem">No hay áreas disponibles.</span>'
'<span style="color:#dc2626;font-size:.85rem">No se pudieron cargar los horarios.</span>'
```

Esto es deuda técnica preexistente en ambos archivos de referencia (regla
#7 de CLAUDE.md — "cero colores hardcodeados" — ya se venía incumpliendo
ahí antes de este plan). **`areas.html` es código nuevo, así que no
replica este patrón.** El equivalente en `areas.html` (p. ej. texto
secundario en la columna descripción, o el mensaje de "Sin permiso" que no
aplica acá porque no hay control por fila) usará clases con tokens:
`style="color:var(--text-3)"` inline si hace falta un one-off, o mejor,
una clase local `.td-secundario { color: var(--text-3) }` reutilizable en
el `<style>` del archivo — no hex.

No hay ningún caso en `areas.html` que dependa de renombrar una clase ya
usada por un `onclick` inline (como sí pasaba con `.btn-ghost`/`.btn-warning`
en servicios-admin.html) porque es un archivo nuevo: los nombres de clase
se definen limpios desde el principio y no hay compatibilidad hacia atrás
que preservar.

### 5.2 — Clases que SÍ se generan dinámicamente y van directo en el CSS local

- `.badge-activo` / `.badge-inactivo` — igual patrón que servicios (JS arma `class="badge ${a.activo ? ...}"`)
- `.alerta.visible` — vía `mostrarAlerta()`
- `.modal-fondo.abierto` — vía `abrirModal()`/`cerrarModal()`
- `btn btn-ghost btn-sm` (Editar) y `btn btn-sm ${activo ? 'btn-warning' : 'btn-ghost'}` (Activar/Desactivar) — mismos nombres que servicios-admin.html, ya en CSS local

---

## 6. HTML objetivo

```
<head>
  <link rel="stylesheet" href="/assets/design-tokens.css">
  <style> … solo lo local, calcado de servicios-admin.html … </style>
</head>
<body>

  <div class="app-shell">

    <aside class="sidebar">
      sidebar-header (logo MVLA)
      sidebar-user-card (id="sidebar-avatar" + id="nav-nombre")
      sidebar-nav:
        · label "Calendario"
          · Agenda      → /panel/agenda.html
          · Presencial  → /panel/presencial.html
          · Bloqueos    → /panel/bloqueos.html
        · label "Reportes" (id="label-reportes", display:none)
          · Auditoría   (id="nav-auditoria", display:none)
          · Dashboard   (id="nav-dashboard", display:none)
        · label "Admin." (id="label-admin", display:none)
          · Usuarios   (id="nav-usuarios", display:none)
          · Servicios  (id="nav-servicios", display:none)
          · Áreas      ← nav-item.active (sin ID — página activa)
      sidebar-footer (btn-logout-sidebar)
    </aside>

    <main class="main-content">
      <div class="page-inner">

        <div class="page-header">
          <p class="page-supertitle">Panel de gestión</p>
          <h1 class="page-title">Gestión de áreas</h1>
        </div>

        <!-- Card: lista de áreas -->
        <div class="card">
          <div class="card-titulo">
            <span>Áreas del municipio</span>
            <button class="btn btn-secondary btn-sm" onclick="cargarAreas()">↻ Actualizar</button>
          </div>
          <div class="alerta alerta-error" id="error-lista"></div>
          <div class="alerta alerta-ok"    id="ok-lista"></div>
          <div class="tabla-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Descripción</th>
                  <th>Servicios activos</th>
                  <th>Usuarios asignados</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody id="tbody-areas">
                <tr><td colspan="6" class="cargando">Cargando áreas...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Card: nueva área -->
        <div class="card">
          <div class="card-titulo">Nueva área</div>
          <div class="alerta alerta-error" id="error-form"></div>
          <div class="form-grid">
            <div class="form-grupo">
              <label for="nuevo-nombre">Nombre <span class="req">*</span></label>
              <input type="text" id="nuevo-nombre" placeholder="Ej: Tránsito y Habilitaciones">
            </div>
            <div class="form-grupo full">
              <label for="nuevo-descripcion">Descripción (opcional)</label>
              <input type="text" id="nuevo-descripcion" placeholder="Ej: Gestión de habilitaciones comerciales">
            </div>
          </div>
          <div class="form-pie">
            <button class="btn btn-primary" onclick="crearArea()">Crear área</button>
          </div>
        </div>

      </div><!-- .page-inner -->
    </main>

  </div><!-- .app-shell -->

  <!-- Modal de edición -->
  <div class="modal-fondo" id="modal-fondo">
    <div class="modal-caja">
      <h3 id="modal-titulo">Editar área</h3>
      <div class="alerta alerta-error" id="error-modal"></div>
      <div class="form-grid">
        <div class="form-grupo">
          <label for="edit-nombre">Nombre</label>
          <input type="text" id="edit-nombre">
        </div>
        <div class="form-grupo">
          <label for="edit-activo">Estado</label>
          <select id="edit-activo">
            <option value="1">Activo</option>
            <option value="0">Inactivo</option>
          </select>
        </div>
        <div class="form-grupo full">
          <label for="edit-descripcion">Descripción</label>
          <input type="text" id="edit-descripcion">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="guardarEdicion()">Guardar cambios</button>
      </div>
    </div>
  </div>

  <script> … </script>
</body>
```

### Funciones JS (mismo esqueleto que servicios-admin.html)

- Auth: `getToken()`, `getUsuario()`, `apiFetch()`, `cerrarSesion()` — copia literal
- `esc()`, `mostrarAlerta()`, `mostrarAlertaModal()`, `rolBadgeHTML()` — copia literal
- `cargarAreas()` → GET `/panel/areas/admin`
- `renderAreas(data)` → arma filas, botón Desactivar con `confirm()` condicional (§3)
- `crearArea()` → POST `/panel/areas`
- `abrirModal(id, nombre, descripcion, activo)`, `cerrarModal()`, `guardarEdicion()` → PATCH `/panel/areas/:id`
- `toggleActivo(id, nuevoActivo, serviciosActivos, usuariosAsignados)` → confirm condicional (mensaje armado por partes según §3) + PATCH `{activo}`
- `init()` → gate `usuario.rol !== 'sistemas'` → redirect a `/panel/agenda.html`; resto igual a servicios-admin.html (avatar, labels, reveal de nav-items)

---

## 7. Cambio en las otras 7 páginas con sidebar

Afecta: `agenda.html`, `presencial.html`, `bloqueos.html`, `dashboard.html`,
`auditoria.html`, `usuarios.html`, `servicios-admin.html`.
(`login.html` y `cambiar-clave.html` no tienen sidebar — no se tocan.)

### 7.1 — HTML: agregar el link dentro de `label-admin`

```html
<div class="nav-section-label" id="label-admin" style="display:none">Admin.</div>
<a href="/panel/usuarios.html"        class="nav-item" id="nav-usuarios"  style="display:none">Usuarios</a>
<a href="/panel/servicios-admin.html" class="nav-item" id="nav-servicios" style="display:none">Servicios</a>
<a href="/panel/areas.html"           class="nav-item" id="nav-areas"     style="display:none">Áreas</a>
```

(En `servicios-admin.html` y `usuarios.html`, el link a sí mismas queda
`.nav-item.active` sin ID como ya está — solo se agrega la línea de Áreas.)

### 7.2 — JS: revelar `nav-areas` solo para `sistemas`

El patrón actual en las 7 páginas es un `forEach` que revela
`nav-auditoria`/`nav-dashboard`/`nav-usuarios`/`nav-servicios` para
cualquier rol del whitelist (`encargado`, `sistemas`, `directivo`). Como
Áreas es exclusiva de `sistemas`, **no entra en ese `forEach`** — va en un
`if` aparte, igual al bloque que ya existe en `usuarios.html` para agregar
la opción "Sistemas" al selector de rol:

```javascript
// Áreas: exclusivo rol sistemas
if (usuario.rol === 'sistemas') {
  const elArea = document.getElementById('nav-areas');
  if (elArea) elArea.style.display = '';
}
```

Se agrega justo después del bloque de labels (`label-reportes`/`label-admin`)
en el `init()` de cada una de las 7 páginas.

---

## 8. Orden de implementación

### Paso 1 — Backend: 3 endpoints nuevos en routes/panel.js
- `GET /panel/areas/admin` (§2.2)
- `POST /panel/areas` (§2.3)
- `PATCH /panel/areas/:id` (§2.4)
- Verificar que `GET /panel/areas` (existente) sigue devolviendo exactamente
  el mismo shape — no tocarlo.
- Checkpoint: probar los 3 endpoints nuevos con curl/Postman usando un JWT
  de rol sistemas (alta, listado con conteos, edición, y un 403 con un JWT
  de rol encargado).
- Commit: `feat(panel): endpoints ABM de áreas (admin, alta, edición)`

### Paso 2 — Crear public/panel/areas.html completo
- HTML + CSS local (calco de servicios-admin.html, §6)
- JS completo: auth, render, CRUD, modal, confirm condicional de desactivación (§3)
- Checkpoint: cargar la página logueado como `sistemas`, crear un área,
  editarla, desactivar una sin servicios activos (sin confirm) y una con
  servicios activos (con confirm), verificar que el gate de acceso
  redirige a `agenda.html` si se prueba con un JWT de otro rol.
- Commit: `feat(panel): nueva pantalla areas.html — ABM de áreas (rol sistemas)`

### Paso 3 — Agregar el link "Áreas" en las 7 páginas con sidebar
- HTML: línea nueva en `label-admin` (§7.1) en las 7 páginas
- JS: bloque `if (usuario.rol === 'sistemas')` en `init()` de las 7 páginas (§7.2)
- Checkpoint: loguear con cada rol (`operador`, `encargado`, `directivo`,
  `sistemas`) y confirmar que "Áreas" solo aparece para `sistemas`, en las
  7 pantallas.
- Commit: `feat(panel): agregar link "Áreas" al sidebar (rol sistemas) en las 7 páginas`

### Paso 4 — Verificación de cierre
- grep: 0 hex hardcodeado en `areas.html` (ni `<style>` ni HTML estático ni `<script>` — a diferencia de servicios-admin.html, acá el objetivo es 0 en las tres partes, ver §5.1)
- Confirmar que `GET /panel/areas` (el viejo) sigue funcionando igual en agenda/bloqueos/servicios-admin/usuarios (chips B9 no rotos)
- Confirmar auditoría: cada alta/edición de área deja registro en `auditoria` con `entidad_tipo = 'area'`
- Commit: `docs(plan): areas.html — certificación final` (si hay ajustes) o ninguno si Paso 1-3 ya quedó limpio
