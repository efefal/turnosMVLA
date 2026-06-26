# Plan de rediseño — servicios-admin.html
# Referencia: design_handoff_sistema_turnos/README.md
# Restricciones: Vanilla JS · no tocar lógica JS · solo vars de design-tokens.css

---

## Contexto

`servicios-admin.html` gestiona el ABM de servicios del panel. Es el **último archivo** del ciclo de rediseño. Contiene:
- Navbar superior (a reemplazar por sidebar idéntico al de los otros paneles)
- Card: tabla de servicios con selector B9 de área
- Card: formulario de nuevo servicio (2 cols + textarea full-width)
- Modal de edición: datos del servicio

**Es el panel más simple de todos.** No tiene segundo modal, no tiene B2/B3 (checkboxes de área), no tiene B4 (horarios), no tiene reset de clave.

**Diferencias clave respecto a usuarios.html:**
1. **Solo `rolBadgeHTML()`** — no existe `badgeRol()`. El estado activo/inactivo del servicio se resuelve directo en el template string de `renderServicios()`.
2. **`.btn-warning` en template string** — `renderServicios()` genera `class="btn btn-sm ${s.activo ? 'btn-warning' : 'btn-ghost'}"` dinámicamente. Ambas clases deben existir en CSS local. **No renombrar.**
3. **`.btn-ghost` en dos template strings** — también en el botón "Editar" del mismo `renderServicios()`. Mismo problema que usuarios.html. Los botones `.btn-ghost` del HTML estático SÍ se renombran a `.btn-secondary`.
4. **`form-grid-3` es CSS muerto** — definido en el `<style>` pero nunca usado en el HTML. Se elimina.
5. **Hex esperado en `<script>` después del rediseño: 3 líneas** (exclusiones de `renderServicios()`, ver §6).
6. **`nav-usuarios`** aparece en el `forEach` de `init()` (no `nav-servicios`). Esta página muestra el enlace a Usuarios pero no el enlace a sí misma. No cambiar esa lógica.

---

## 1. Inventario de IDs obligatorios

### Sidebar

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `nav-nombre` | `init()` | inyecta `nombre + rolBadgeHTML()` |
| `sidebar-avatar` | `init()` — **agregar** | iniciales + color según rol |
| `label-reportes` | `init()` — **agregar** | muestra label "Reportes" |
| `label-admin` | `init()` — **agregar** | muestra label "Admin." |
| `nav-auditoria` | `init()` | muestra via `style.display = ''` |
| `nav-dashboard` | `init()` | muestra via `style.display = ''` |
| `nav-usuarios` | `init()` | muestra via `style.display = ''` |

> "Servicios" en el sidebar es `.nav-item.active` hardcodeado — sin ID, siempre visible aquí.

### B9 — Chips de área

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `selector-areas-srv` | `inicializarChipsServicios()` | agrega clase `.visible` |
| `chips-areas-srv` | `inicializarChipsServicios()` | inserta `<span class="area-chip">` |

> Nombres distintos a los de auditoria.html y usuarios.html. No intercambiar.

### Tabla / alertas de lista

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `error-lista` | `mostrarAlerta()` | toggle `.visible` + textContent |
| `ok-lista` | `mostrarAlerta()` | toggle `.visible` + textContent + auto-hide 4s |
| `tbody-servicios` | `renderServicios()`, `cargarServicios()` | `.innerHTML` con filas |

### Formulario nuevo servicio

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `card-nuevo-servicio` | `init()` | `style.display = 'none'` si directivo |
| `nuevo-nombre` | `crearServicio()` | `.value` leído |
| `nuevo-area` | `crearServicio()`, `poblarSelectArea()` | `.value` + `innerHTML` |
| `nuevo-duracion` | `crearServicio()` | `.value` leído |
| `nuevo-anticipacion` | `crearServicio()` | `.value` leído |
| `nuevo-mensaje` | `crearServicio()` | `.value` leído / borrado |
| `error-form` | `mostrarAlerta()` | toggle `.visible` |

### Modal de edición

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `modal-fondo` | `abrirModal()`, `cerrarModal()`, `init()` | toggle clase `.abierto` |
| `error-modal` | `mostrarAlertaModal()` | toggle `.visible` |
| `edit-nombre` | `abrirModal()`, `guardarEdicion()` | `.value` |
| `edit-duracion` | `abrirModal()`, `guardarEdicion()` | `.value` |
| `edit-anticipacion` | `abrirModal()`, `guardarEdicion()` | `.value` |
| `edit-activo` | `abrirModal()`, `guardarEdicion()` | `.value` (`'1'`/`'0'`) |
| `edit-mensaje` | `abrirModal()`, `guardarEdicion()` | `.value` |

---

## 2. Clases CSS generadas dinámicamente por JS

### Por `inicializarChipsServicios()`
- `.area-chip` — chip base (createElement + className)
- `.area-chip.activo` — chip seleccionado (classList.add/remove/toggle)

### Por `mostrarAlerta()` y `mostrarAlertaModal()`
- `.alerta.visible` — muestra bloque (classList.add/remove)

### Por `renderServicios()` en `#tbody-servicios`
- `.badge` — base del badge (hardcoded en template string)
- `.badge-activo` / `.badge-inactivo` — estado del servicio
- `.vacio` — sin resultados
- `.cargando` — estado de carga
- `btn btn-ghost btn-sm` — botón Editar (**no renombrar**)
- `btn btn-sm btn-warning` / `btn btn-sm btn-ghost` — botón Activar/Desactivar (**no renombrar ninguno**)

### Por `cargarServicios()` al inicio
- `.cargando` — innerHTML durante carga

### Por `abrirModal()` / `cerrarModal()`
- `.modal-fondo.abierto` — abre el modal (classList.add/remove)

---

## 3. Funciones JS — categorización

### Lógica de negocio — NO MODIFICAR

| Función | Por qué |
|---|---|
| `getToken()`, `getUsuario()`, `apiFetch()`, `cerrarSesion()` | Auth |
| `esc(s)` | Sanitización HTML |
| `mostrarAlerta()`, `mostrarAlertaModal()` | Estado UI |
| `inicializarChipsServicios()`, `aplicarFiltroArea()` | B9 filtro |
| `renderServicios(data)` | Render tabla — contiene lógica de permisos y toggle |
| `cargarServicios()` | CRUD |
| `poblarSelectArea()` | Pobla select de área |
| `crearServicio()` | CRUD |
| `abrirModal()`, `cerrarModal()`, `guardarEdicion()` | Modal edición |
| `toggleActivo()` | Activa/desactiva desde la tabla |
| `init()` | Bootstrap (con adiciones de sidebar) |

### Presentación — SE PUEDE REESCRIBIR

| Función | Qué cambiar |
|---|---|
| `rolBadgeHTML(rol)` | Inline styles → `.role-badge .role-XXX` |

---

## 4. Mismatches críticos

### A. `rolBadgeHTML()` — igual que usuarios.html

```javascript
// ANTES:
function rolBadgeHTML(rol) {
  const cfg = {
    operador:  { bg: '#1e40af', label: 'Operador' },
    encargado: { bg: '#166534', label: 'Encargado' },
    sistemas:  { bg: '#6b21a8', label: 'Sistemas' },
    directivo: { bg: '#374151', label: 'Solo lectura' },
  };
  const { bg, label } = cfg[rol] || { bg: '#374151', label: rol };
  return `<span class="badge-rol" style="background:${bg};color:white">${label}</span>`;
}

// DESPUÉS:
function rolBadgeHTML(rol) {
  const cfg = {
    operador:  { cls: 'role-operador',  label: 'Operador'     },
    encargado: { cls: 'role-encargado', label: 'Encargado'    },
    sistemas:  { cls: 'role-sistemas',  label: 'Sistemas'     },
    directivo: { cls: 'role-directivo', label: 'Solo lectura' },
  };
  const { cls, label } = cfg[rol] || { cls: 'role-admin', label: rol };
  return `<span class="role-badge ${cls}">${label}</span>`;
}
```

### B. `.btn-ghost` y `.btn-warning` en template strings — mantener en CSS local

`renderServicios()` genera:
```javascript
// Botón Editar:
`<button class="btn btn-ghost btn-sm" onclick="abrirModal(...)">Editar</button>`

// Botón Activar/Desactivar:
`<button class="btn btn-sm ${s.activo ? 'btn-warning' : 'btn-ghost'}" onclick="toggleActivo(...)">
  ${s.activo ? 'Desactivar' : 'Activar'}
</button>`
```

Consecuencias:
- `.btn-ghost` se **mantiene en CSS local** (idéntico a `.btn-secondary`)
- `.btn-warning` se **mantiene en CSS local** con `background: var(--amber)`
- Los 2 botones `.btn-ghost` del **HTML estático** (L126 Actualizar, L224 Cancelar modal) SÍ se renombran a `.btn-secondary`

### C. `form-grid-3` — eliminar (CSS muerto)

El CSS define `.form-grid-3` pero el HTML nunca lo usa. Se elimina del `<style>`.

---

## 5. Inline styles en HTML estático — a extraer a clases

| Línea | HTML actual | Solución |
|---|---|---|
| L162 | `<span style="color:#dc2626">*</span>` (nombre) | `<span class="req">*</span>` |
| L166 | `<span style="color:#dc2626">*</span>` (área) | `<span class="req">*</span>` |
| L172 | `<span style="color:#dc2626">*</span>` (duración) | `<span class="req">*</span>` |

Solo 3 inline styles en HTML estático — los más simples del proyecto.

### Style attributes que SE MANTIENEN (JS-controlled)
- `#nav-auditoria style="display:none"` — `init()` usa `style.display = ''`
- `#nav-dashboard style="display:none"` — ídem
- `#nav-usuarios style="display:none"` — ídem
- `#card-nuevo-servicio` sin style (el JS asigna `style.display = 'none'` si directivo)

---

## 6. Inline styles en `<script>` — exclusiones (3 líneas hex)

Estos inline styles están en el template string de `renderServicios()`. No se modifican.

```javascript
// renderServicios() L354
<td style="color:#64748b">${esc(s.area_nombre)}</td>

// renderServicios() L358
'<span style="color:#94a3b8">Sin mensaje</span>'

// renderServicios() L360
'<span style="color:#94a3b8;font-size:.78rem">Solo lectura</span>'
```

**Hex count esperado en `<script>` después del rediseño: 3 líneas.**

Adicionalmente, hay un style attribute sin hex que tampoco se toca:
- `renderServicios()` L354: `<td style="font-weight:500">` — sin hex

---

## 7. Mapeo de colores hardcodeados → tokens

### CSS en `<style>` interno

| Contexto | Valor actual | Token equivalente |
|---|---|---|
| Body bg `#f1f5f9` | — | cubierto por design-tokens.css (`--bg-2`) |
| Body color `#1e293b` | — | cubierto (`--text-1`) |
| `.navbar` + `.nav-*` + `.badge-rol` | eliminados | → sidebar |
| `h1 color: #1A3C4B; font-family: Trebuchet` | eliminado | → `.page-title` |
| `.card bg: white` | `white` | `var(--bg-3)` |
| `.card box-shadow: rgba(0,0,0,.08)` | — | `0 0 0 1px var(--border)` |
| `.card-titulo color: #1A3C4B; font-family: Trebuchet` | — | `var(--text-1)`, `var(--font-ui)` |
| `.btn-primary bg: #1A3C4B` | — | drop: usar `.btn-primary` de design-tokens.css |
| `.btn-ghost bg: white; color: #374151; border: #d1d5db` | — | keep local: `var(--bg-4)`, `var(--text-2)`, `var(--border)` |
| `.btn-warning bg: #d97706` | `#d97706` | `var(--amber)` |
| `.alerta-error bg: #fef2f2; border: #fecaca; color: #991b1b` | — | `var(--red-dim)`, `var(--red-mid)`, `var(--red)` |
| `.alerta-ok bg: #f0fdf4; border: #bbf7d0; color: #166534` | — | `var(--teal-dim)`, `var(--teal-mid)`, `var(--teal)` |
| `th bg: #f8fafc; color: #64748b; border: #e2e8f0` | — | `var(--bg-1)`, `var(--text-3)`, `var(--border)` |
| `td border: #f1f5f9` | `#f1f5f9` | `var(--border)` |
| `tr:hover bg: #fafafa` | `#fafafa` | `var(--bg-4)` |
| `.td-mensaje color: #64748b` | `#64748b` | `var(--text-3)` |
| `.badge-activo bg: #dcfce7; color: #166534` | — | `var(--teal-dim)`, `var(--teal)` |
| `.badge-inactivo bg: #fee2e2; color: #b91c1c` | — | `var(--red-dim)`, `var(--red)` |
| `.form-grupo label color: #374151` | `#374151` | `var(--text-2)` |
| `input/select/textarea border: #d1d5db; bg: white` | — | `var(--border)`, `var(--bg-4)` |
| `input:focus border: #1A3C4B; box-shadow: rgba(26,60,75,.1)` | — | `var(--border-hi)`, `var(--teal-dim)` |
| `.form-hint color: #64748b` | `#64748b` | `var(--text-3)` |
| `.modal-caja bg: white` | `white` | `var(--bg-3)` |
| `.modal-caja box-shadow: rgba(0,0,0,.25)` | — | `0 20px 60px rgba(0,0,0,.55)` |
| `.modal-caja h3 color: #1e293b; font-family: Trebuchet` | — | `var(--text-1)`, `var(--font-ui)` |
| `.cargando color: #94a3b8` | `#94a3b8` | `var(--text-3)` |
| `.vacio color: #94a3b8` | `#94a3b8` | `var(--text-3)` |
| `.area-selector-titulo color: #64748b` | `#64748b` | `var(--text-3)` |
| `.area-chip border: #e2e8f0; color: #475569; bg: white` | — | `var(--border)`, `var(--text-2)`, `transparent` |
| `.area-chip:hover border/color: #1A3C4B` | `#1A3C4B` | `var(--border-hi)`, `var(--text-1)` |
| `.area-chip.activo border/bg: #1A3C4B; color: white` | `#1A3C4B` | `var(--teal-mid)`, `var(--teal-dim)`, `var(--teal)` |

---

## 8. Nueva estructura HTML objetivo

```
<head>
  <link rel="stylesheet" href="/assets/design-tokens.css">
  <style> … solo lo local … </style>
</head>
<body>

  <div class="app-shell">

    <aside class="sidebar">
      sidebar-header (logo MVLA)
      sidebar-user-card (id="sidebar-avatar")
      sidebar-nav:
        · label "Calendario"
          · Agenda      → /panel/agenda.html
          · Presencial  → /panel/presencial.html
          · Bloqueos    → /panel/bloqueos.html
        · label "Reportes" (id="label-reportes", style="display:none")
          · Auditoría   (id="nav-auditoria", style="display:none")
          · Dashboard   (id="nav-dashboard", style="display:none")
        · label "Admin." (id="label-admin", style="display:none")
          · Usuarios   (id="nav-usuarios", style="display:none")
          · Servicios  ← nav-item.active (sin ID — siempre visible aquí)
      sidebar-footer (id="nav-nombre" + btn-logout-sidebar)
    </aside>

    <main class="main-content">
      <div class="page-inner">

        <div class="page-header">
          <p class="page-supertitle">Panel de gestión</p>
          <h1 class="page-title">Gestión de servicios</h1>
        </div>

        <!-- Card: lista de servicios -->
        <div class="card">
          <div class="card-titulo">
            <span>Servicios del área</span>
            <button class="btn btn-secondary btn-sm" onclick="cargarServicios()">↻ Actualizar</button>
          </div>
          <!-- B9 -->
          <div class="area-selector" id="selector-areas-srv"> … </div>
          <!-- alertas -->
          <div class="alerta alerta-error" id="error-lista"></div>
          <div class="alerta alerta-ok"    id="ok-lista"></div>
          <!-- tabla -->
          <div class="tabla-wrapper"> … <tbody id="tbody-servicios"> … </div>
        </div>

        <!-- Card: nuevo servicio -->
        <div class="card" id="card-nuevo-servicio">
          <div class="card-titulo">Nuevo servicio</div>
          <div class="alerta alerta-error" id="error-form"></div>
          <div class="form-grid">
            <!-- campos con <span class="req">*</span> -->
            <!-- textarea full-width -->
          </div>
          <div class="form-pie">
            <button class="btn btn-primary" onclick="crearServicio()">Crear servicio</button>
          </div>
        </div>

      </div><!-- .page-inner -->
    </main>

  </div><!-- .app-shell -->

  <!-- Modal edición — cambios: -->
  <!-- btn-ghost → btn-secondary en Cancelar -->

  <script> … </script>
</body>
```

---

## 9. CSS nuevo para el `<style>` interno

```css
/* ══════════════════════════════════════════════════════════════
   servicios-admin.html — estilos locales (design system C+)
   Todos los colores vienen de design-tokens.css.
══════════════════════════════════════════════════════════════ */

/* ── Layout shell ────────────────────────────────────────────── */
.app-shell    { display: flex; height: 100vh; overflow: hidden; }
.main-content { flex: 1; overflow-y: auto; background: var(--bg-2); }
.page-inner   { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }

/* ── Header de página ────────────────────────────────────────── */
.page-supertitle {
  font-size: var(--text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--teal);
  margin-bottom: 0.2rem;
}
.page-title {
  font-size: var(--text-xl);
  font-weight: 800;
  color: var(--text-1);
  margin-bottom: 1.5rem;
}

/* ── Sidebar (idéntico a dashboard/auditoria/usuarios) ───────── */
.sidebar { width: var(--sidebar-width); background: var(--bg-1); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; overflow-y: auto; }
.sidebar-header { display: flex; align-items: center; gap: var(--gap-sm); padding: 14px 12px 10px; border-bottom: 1px solid var(--border); }
.sidebar-logo { width: 36px; height: 36px; border-radius: var(--radius-xl); background: var(--teal-dim); color: var(--teal); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; flex-shrink: 0; letter-spacing: 0.04em; }
.sidebar-muni { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); }
.sidebar-ciudad { font-size: 12.5px; font-weight: 700; color: var(--text-1); }
.sidebar-user-card { margin: 8px; padding: 7px 9px; border-radius: var(--radius-md); display: flex; align-items: center; gap: var(--gap-sm); }
.sidebar-avatar { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: var(--text-xs); font-weight: 700; flex-shrink: 0; }
.nav-section-label { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-3); padding: 10px 12px 4px; }
.sidebar-nav { padding: 0 6px; flex: 1; }
.sidebar-footer { border-top: 1px solid var(--border); padding: 10px 12px; }
.btn-logout-sidebar { background: transparent; border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--text-2); padding: 5px 10px; font-family: var(--font-ui); font-size: var(--text-sm); cursor: pointer; width: 100%; transition: var(--transition-fast); }
.btn-logout-sidebar:hover { background: var(--bg-4); border-color: var(--border-hi); color: var(--text-1); }

/* ── Card ────────────────────────────────────────────────────── */
.card {
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
}
.card-titulo {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  font-family: var(--font-ui);
  font-weight: 700;
  color: var(--text-1);
  font-size: var(--text-base);
}

/* ── Botones locales ─────────────────────────────────────────── */
/* .btn, .btn-primary, .btn-secondary → vienen de design-tokens.css */
.btn-ghost   { background: var(--bg-4); color: var(--text-2); border: 1px solid var(--border); }
.btn-ghost:hover:not(:disabled) { border-color: var(--border-hi); color: var(--text-1); }
.btn-warning { background: var(--amber); color: var(--bg-0); border: none; }
.btn-sm      { padding: 0.25rem 0.6rem; font-size: var(--text-sm); }

/* ── Alertas ─────────────────────────────────────────────────── */
.alerta { padding: 0.7rem 1rem; border-radius: var(--radius-md); font-size: var(--text-base); margin-bottom: 1rem; display: none; }
.alerta.visible { display: block; }
.alerta-error { background: var(--red-dim);  border: 1px solid var(--red-mid);  color: var(--red);  }
.alerta-ok    { background: var(--teal-dim); border: 1px solid var(--teal-mid); color: var(--teal); }

/* ── Tabla ───────────────────────────────────────────────────── */
.tabla-wrapper { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th {
  background: var(--bg-1);
  color: var(--text-3);
  font-family: var(--font-ui);
  font-weight: 600;
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.7rem 1rem;
  border-bottom: 2px solid var(--border);
  text-align: left;
  white-space: nowrap;
}
td { padding: 0.8rem 1rem; border-bottom: 1px solid var(--border); vertical-align: middle; font-size: var(--text-base); color: var(--text-1); }
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--bg-4); }
.td-acciones { display: flex; gap: 0.35rem; flex-wrap: wrap; }
.td-mensaje  { max-width: 220px; font-size: var(--text-sm); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── Badges de estado ────────────────────────────────────────── */
/* .role-badge y .role-* vienen de design-tokens.css */
.badge         { display: inline-block; padding: 0.18rem 0.55rem; border-radius: 99px; font-size: var(--text-xs); font-weight: 600; }
.badge-activo  { background: var(--teal-dim); color: var(--teal); }
.badge-inactivo{ background: var(--red-dim);  color: var(--red);  }

/* ── Utilidades ──────────────────────────────────────────────── */
.req { color: var(--red); }

/* ── Formulario ──────────────────────────────────────────────── */
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
@media (max-width: 680px) { .form-grid { grid-template-columns: 1fr; } }
.form-grupo { display: flex; flex-direction: column; gap: 0.3rem; }
.form-grupo.full { grid-column: 1 / -1; }
.form-grupo label { font-size: var(--text-sm); font-weight: 500; color: var(--text-2); }
.form-grupo input,
.form-grupo select { padding: 0.4rem 0.65rem; border: 1px solid var(--border); border-radius: var(--radius-md); font-size: var(--text-base); font-family: var(--font-ui); background: var(--bg-4); color: var(--text-1); }
.form-grupo textarea { padding: 0.4rem 0.65rem; border: 1px solid var(--border); border-radius: var(--radius-md); font-size: var(--text-base); font-family: var(--font-ui); resize: vertical; background: var(--bg-4); color: var(--text-1); }
.form-grupo input:focus, .form-grupo select:focus, .form-grupo textarea:focus { outline: none; border-color: var(--border-hi); box-shadow: 0 0 0 2px var(--teal-dim); }
.form-pie  { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
.form-hint { font-size: var(--text-xs); color: var(--text-3); margin-top: 0.2rem; }

/* ── Modal ───────────────────────────────────────────────────── */
.modal-fondo { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 200; align-items: center; justify-content: center; padding: 1rem; }
.modal-fondo.abierto { display: flex; }
.modal-caja { background: var(--bg-3); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.5rem; max-width: 560px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,.55); max-height: 90vh; overflow-y: auto; }
.modal-caja h3 { font-family: var(--font-ui); font-size: var(--text-xl); color: var(--text-1); margin-bottom: 1rem; font-weight: 800; }
.modal-footer { display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: 1rem; }

/* ── B9: Selector de área ────────────────────────────────────── */
.area-selector { margin-bottom: 1rem; display: none; }
.area-selector.visible { display: block; }
.area-selector-titulo { font-size: var(--text-xs); font-weight: 600; color: var(--text-3); margin-bottom: 0.4rem; text-transform: uppercase; letter-spacing: 0.04em; }
.area-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.area-chip { display: inline-flex; align-items: center; padding: 0.3rem 0.7rem; border: 1px solid var(--border); border-radius: 99px; cursor: pointer; font-size: var(--text-sm); font-weight: 500; color: var(--text-2); background: transparent; transition: var(--transition-fast); user-select: none; }
.area-chip:hover  { border-color: var(--border-hi); color: var(--text-1); }
.area-chip.activo { border-color: var(--teal-mid); background: var(--teal-dim); color: var(--teal); font-weight: 600; }

/* ── Misc ────────────────────────────────────────────────────── */
.cargando { text-align: center; color: var(--text-3); padding: 3rem; font-style: italic; }
.vacio    { text-align: center; color: var(--text-3); padding: 3rem; }
```

---

## 10. Cambios en el bloque `<script>`

### `rolBadgeHTML()` — ver §4.A

### `init()` — agregar bloque sidebar-avatar + labels (después de `nombreEl.innerHTML = ...`)

```javascript
// Sidebar avatar: iniciales + color según rol
const avatarEl = document.getElementById('sidebar-avatar');
if (avatarEl) {
  const partes    = (usuario.nombre || '').trim().split(/\s+/);
  const iniciales = partes.slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || '?';
  const avatarCfg = {
    encargado: { bg: 'var(--teal-mid)',  color: 'var(--teal)'  },
    operador:  { bg: 'var(--blue-mid)',  color: 'var(--blue)'  },
    sistemas:  { bg: 'var(--amber-mid)', color: 'var(--amber)' },
    directivo: { bg: 'var(--amber-mid)', color: 'var(--amber)' },
  };
  const ac = avatarCfg[usuario.rol] || avatarCfg.operador;
  avatarEl.textContent      = iniciales;
  avatarEl.style.background = ac.bg;
  avatarEl.style.color      = ac.color;
}

// Labels de sección del sidebar
const lRep = document.getElementById('label-reportes');
if (lRep) lRep.style.display = '';
const lAdm = document.getElementById('label-admin');
if (lAdm) lAdm.style.display = '';
```

> El forEach existente que muestra `nav-auditoria`, `nav-dashboard`, `nav-usuarios` se mantiene sin cambios.

---

## 11. Verificaciones de cierre (Paso 2 y 3)

### Paso 2 — Clases generadas por JS

- ¿`.area-chip` y `.area-chip.activo` en CSS?
- ¿`.alerta.visible` con `display: block`?
- ¿`.badge-activo` y `.badge-inactivo` con tokens?
- ¿`.badge` (base) presente?
- ¿`.cargando` y `.vacio` presentes?
- ¿`.modal-fondo.abierto { display: flex }`?
- ¿`.btn-ghost` en CSS local? (usado en dos template strings)
- ¿`.btn-warning` en CSS local? (usado en template string de toggle)

### Paso 3 — Certificación

- grep: 0 hex en `<style>`
- grep: 0 hex en HTML estático
- `.navbar`, `.nav-links`, `.nav-user`, `.btn-logout[^-]`, `.badge-rol`, `.form-grid-3` en `<style>` → 0
- `rolBadgeHTML()` sin hex ni `style=`
- Hex count en `<script>` = 3 líneas (exclusiones §6)
- 0 ocurrencias de `btn-ghost` en HTML estático (renombradas a `btn-secondary`)
- `btn-ghost` y `btn-warning` solo en template strings dentro de `<script>`

---

## 12. Orden de implementación

### Paso 1 — Layout shell, sidebar, CSS completo + ajustes de JS ✅ COMPLETADO

8/8 verificaciones PASS (2026-06-26):
- 0 hex en `<style>` y HTML estático ✅ (3 hex en `<script>` — exclusiones §6)
- CSS viejo eliminado: `.navbar`, `.nav-links`, `.nav-user`, `.btn-logout`, `.badge-rol`, `.form-grid-3` → 0 ✅
- Hex count en `<script>` = 3 ✅
- 27/27 IDs del §1 presentes en el DOM ✅
- `btn-ghost` → `btn-secondary` en Actualizar (L207) y Cancelar modal (L308) ✅
- 3 asteriscos extraídos a `class="req"` (L243, L247, L253) ✅
- `rolBadgeHTML()` sin hex ni `style=` ✅
- `.form-grid-3` eliminado del CSS ✅

### Paso 2 — Verificación de clases generadas por JS

- Confirmar clases del §11 Paso 2

### Paso 3 — Certificación final

- Checks del §11 Paso 3

### Commit
`feat(panel): servicios-admin — rediseño design system C+`
