# Plan de rediseño — auditoria.html
# Referencia: design_handoff_sistema_turnos/README.md § "Dashboard — Auditoría"
# Restricciones: Vanilla JS · no tocar lógica JS · solo vars de design-tokens.css

---

## Contexto

`auditoria.html` es la pantalla de registro de auditoría del panel. Contiene:
- Navbar superior (a reemplazar por sidebar idéntico al de dashboard.html / bloqueos.html)
- Selector de área B9 (chips, mismo patrón que dashboard.html)
- Tres paneles de filtros B7 (dropdowns con checkboxes: Usuarios, Acciones, Entidades) — elemento nuevo no presente en otras páginas
- Tabla paginada de 7 columnas con badges de acción coloreados

**Punto crítico:** la función `badgeAccion()` genera clases `badge-accion accion-{valor}` donde
`{valor}` viene de la base de datos en español (`crear`, `modificar`, `cancelar`, etc.).
El design-tokens.css define `.audit-badge` con variantes en inglés de 5 tipos
(`.audit-create`, `.audit-edit`, `.audit-block`, `.audit-delete`, `.audit-system`).
Como no se puede modificar el JS, no se pueden usar las clases de tokens directamente.
La solución es **mantener los nombres `.badge-accion.accion-*` en el CSS local** y reescribir
sus valores con tokens en lugar de hex (ver §4 para el mapeo completo).

---

## 1. Inventario de IDs obligatorios

### Sidebar

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `nav-nombre` | `init()` | inyecta `nombre + rolBadgeHTML()` |
| `sidebar-avatar` | `init()` | iniciales + color según rol (**no existe — hay que agregarlo**) |
| `label-reportes` | `init()` | muestra label "Reportes" (**no existe — hay que agregarlo**) |
| `label-admin` | `init()` | muestra label "Admin." (**no existe — hay que agregarlo**) |
| `nav-dashboard` | `init()` | muestra via `style.display` |
| `nav-usuarios` | `init()` | muestra via `style.display` |
| `nav-servicios` | `init()` | muestra via `style.display` |

> El link "Auditoría" en el sidebar NO necesita ID: es `.nav-item.active` hardcodeado en
> esta página. A diferencia de dashboard.html donde `nav-auditoria` empieza oculto y se
> muestra desde init(), aquí Auditoría es la página activa y siempre visible.

### B9 — Selector de área

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `area-selector` | `inicializarSelectorArea()` | agrega clase `.visible` |
| `area-chips` | `inicializarSelectorArea()` | inserta `<span class="area-chip">` dinámicamente |

> **Diferencia vs dashboard.html:** los IDs aquí son `area-selector` / `area-chips`,
> no `selector-areas-dash` / `chips-areas-dash`. No intercambiar.

### Filtros

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `filtro-desde` | `cargar()` | `.value` leído |
| `filtro-hasta` | `cargar()` | `.value` leído |
| `panel-usuarios` | `togglePanel()`, `actualizarEtiqueta()` | contenedor del panel |
| `lbl-usuarios` | `actualizarEtiqueta()` | `.textContent` del botón |
| `drop-usuarios` | `togglePanel()` | toggle clase `.abierto` |
| `chk-todos-usuarios` | `toggleTodos()` | checkbox maestro |
| `lista-usuarios` | `agregarCheckItem()`, `getSeleccionados()`, `toggleTodos()` | checkboxes dinámicos |
| `panel-acciones` | ídem | ídem |
| `lbl-acciones` | ídem | ídem |
| `drop-acciones` | ídem | ídem |
| `chk-todos-acciones` | ídem | ídem |
| `lista-acciones` | ídem | ídem |
| `panel-entidades` | ídem | ídem |
| `lbl-entidades` | ídem | ídem |
| `drop-entidades` | ídem | ídem |
| `chk-todos-entidades` | ídem | ídem |
| `lista-entidades` | ídem | ídem |

### Tabla, estado y paginación

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `alerta-error` | `mostrarError()` | `.textContent` + toggle `.visible` |
| `tbody` | `cargar()` | `.innerHTML` con filas HTML |
| `estado-carga` | `cargar()` | `style.display = 'block'/'none'` + `.textContent` |
| `pag-info` | `cargar()` | `.textContent` con rango/total |
| `btn-anterior` | `cargar()` | `.disabled` |
| `btn-siguiente` | `cargar()` | `.disabled` |

---

## 2. Clases CSS generadas dinámicamente por JS

### Por `inicializarSelectorArea()` — chips de área
- `.area-chip` — chip base
- `.area-chip.activo` — chip seleccionado (via `classList.toggle`, `classList.add/remove`)

### Por `actualizarEtiqueta()` — botón de panel de filtro
- `.filtro-panel-btn.activo` — botón cuando la selección es parcial (via `classList.toggle`)

### Por `togglePanel()` — dropdown
- `.filtro-panel-dropdown.abierto` — muestra el dropdown (via `classList.add/remove`)

### Por `agregarCheckItem()` — checkboxes inyectados via innerHTML
- `.check-item` — fila de checkbox con `<label>` y `<input type="checkbox">`

### Por `mostrarError()`
- `.alerta.visible` — muestra el bloque de error

### Por `cargar()` en `#tbody`
- `.badge-accion.accion-{valor}` — **MISMATCH** con tokens (ver §4)
- `.td-fecha` — celda de fecha/hora
- `.td-ref` — celda de referencia
- `.td-detalle` — celda de detalle JSON
- `.vacio` — mensaje de sin resultados (dentro de `<td colspan="7">`)

### Por `cargar()` en `#estado-carga`
- `.cargando` — toggled via `style.display` (no via clase)

---

## 3. Funciones JS — categorización

### Lógica de negocio — NO MODIFICAR

| Función | Por qué no se toca |
|---|---|
| `getToken()`, `getUsuario()`, `apiFetch()`, `cerrarSesion()` | Auth |
| `esc(s)` | Sanitización HTML |
| `formatFecha(ts)` | Parseo y formato de timestamp |
| `mostrarError(msg)` | Estado de alertas |
| `inicializarSelectorArea(areas)` | B9 chips con handlers de filtro |
| `seleccionarArea(id, areas)` | Lógica de selección múltiple de área |
| `togglePanel(panelId)` | Abrir/cerrar dropdown de filtro |
| `toggleTodos(tipo)` | Checkbox maestro de un panel |
| `onCheckChange(tipo)` | Sincronización estado checkboxes |
| `actualizarEtiqueta(tipo)` | Actualiza texto y estado del botón de panel |
| `getSeleccionados(tipo)` | Lee checkboxes activos para construir query |
| `agregarCheckItem(listaId, value, label, checked)` | Inyecta checkboxes |
| `cargar(pagina)` | Fetch al endpoint + render de tabla |
| `buscar()`, `irPagina(n)`, `limpiarFiltros()` | Helpers de control |
| `cargarUsuarios()` | Fetch `/panel/auditoria/usuarios` → dropdown |
| `rellenarAcciones()` | Rellena lista estática de acciones |
| `rellenarEntidades()` | Rellena lista estática de entidades |
| `init()` | Bootstrap (con adiciones de sidebar — ver §9) |

### Presentación — SE PUEDE REESCRIBIR

| Función | Qué se puede cambiar |
|---|---|
| `rolBadgeHTML(rol)` | Reemplazar inline styles hardcodeados por `.role-badge .role-XXX` — igual que bloqueos/presencial/dashboard |

---

## 4. MISMATCH CRÍTICO — badges de acción

### El problema

`badgeAccion()` genera clases con nombres en español basados en los valores de la BD:

```javascript
function badgeAccion(accion) {
  return `<span class="badge-accion accion-${esc(accion)}">${esc(accion)}</span>`;
}
```

Acciones posibles (de `rellenarAcciones()`):
`crear` · `modificar` · `cancelar` · `eliminar` · `bloquear` · `desbloquear` · `login` · `logout`

El design-tokens.css tiene `.audit-badge` con 5 variantes en inglés:
`.audit-create` · `.audit-edit` · `.audit-block` · `.audit-delete` · `.audit-system`

**No se puede cambiar el JS** → las clases `.badge-accion.accion-*` deben mantenerse en el CSS local.

### La solución

Reescribir `.badge-accion` y `.accion-*` con los mismos tokens semánticos que usan las clases
`.audit-*` de design-tokens.css, copiando sus valores de color y background.

```css
/* Las clases .audit-badge y .audit-* de design-tokens.css NO se usan aquí.
   Se replican sus valores en .badge-accion y .accion-* por restricción del JS. */
.badge-accion {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 20px;
  font-size: var(--text-xs);
  font-weight: 600;
  font-family: var(--font-ui);
}
```

### Tabla de mapeo

| Clase actual (CSS local) | Color actual | Semántica | Color con tokens |
|---|---|---|---|
| `.accion-crear` | `#dcfce7` / `#166534` | Alta → `audit-create` | `var(--teal)` / `rgba(45,212,160,.18)` / `rgba(45,212,160,.44)` |
| `.accion-modificar` | `#dbeafe` / `#1e40af` | Edición → `audit-edit` | `var(--blue)` / `rgba(75,168,248,.18)` / `rgba(75,168,248,.44)` |
| `.accion-cancelar` | `#fee2e2` / `#b91c1c` | Baja → `audit-delete` | `var(--red)` / `rgba(245,104,104,.18)` / `rgba(245,104,104,.44)` |
| `.accion-eliminar` | `#fee2e2` / `#b91c1c` | Baja → `audit-delete` | mismo que cancelar |
| `.accion-bloquear` | `#fef3c7` / `#92400e` | Bloqueo → `audit-block` | `var(--amber)` / `rgba(245,165,42,.18)` / `rgba(245,165,42,.44)` |
| `.accion-desbloquear` | `#f3f4f6` / `#4b5563` | Sistema → `audit-system` | `var(--text-2)` / `rgba(110,144,171,.18)` / `rgba(110,144,171,.44)` |
| `.accion-login` | `#ede9fe` / `#6d28d9` | Sistema → `audit-system` | mismo que desbloquear (sin token purple) |
| `.accion-logout` | `#f3f4f6` / `#4b5563` | Sistema → `audit-system` | mismo que desbloquear |

> **Nota rgba de `audit-system`:** design-tokens.css mismo usa `rgba(110, 144, 171, 0.18/0.44)`
> en `.audit-system` porque no existen `--text-2-dim` ni `--text-2-mid`. Se replican aquí con
> el mismo criterio.

> **Nota `.accion-login`:** el color original (purple `#6d28d9`) no tiene token equivalente.
> Se mapea a `audit-system` (neutral/sistema) porque login/logout son acciones de acceso.
> Este cambio visual es intencional y está documentado aquí.

---

## 5. Exclusiones del rediseño — inline styles en `<script>`

Estos inline styles están embebidos en template strings de `cargar()`. Modificarlos
requeriría tocar lógica JS → quedan excluidos, igual que en dashboard.html §4.

```javascript
// Referencia sin descripción (línea 501) — color de ID numérico
: `<span style="color:#94a3b8">#${r.entidad_id}</span>`

// Fila sin usuario (línea 505) — indicador de acción del sistema
'<span style="color:#94a3b8">Sistema</span>'

// Canal (línea 509) — metadato secundario
<td style="color:#64748b">${esc(r.canal)}</td>
```

---

## 6. Mapeo de colores hardcodeados → tokens

### CSS en `<style>` interno

| Contexto | Valor actual | Token equivalente |
|---|---|---|
| Body bg | `#f1f5f9` | cubierto por design-tokens.css (`--bg-2`) |
| Body color | `#1e293b` | cubierto (`--text-1`) |
| Body font | `system-ui...` | cubierto (`var(--font-ui)`) |
| `.navbar { background: #1A3C4B }` | eliminado | → sidebar |
| `.nav-links`, `.nav-user`, `.btn-logout`, `.badge-rol` | eliminados | → sidebar y `.role-badge` |
| `h1 { color: #1A3C4B; font-family: Trebuchet }` | eliminado | → `.page-title` |
| `.card { background: white }` | `white` | `var(--bg-3)` |
| `.card { box-shadow: rgba(0,0,0,.08) }` | — | `0 0 0 1px var(--border)` |
| `.area-selector-titulo { color: #64748b }` | `#64748b` | `var(--text-3)` |
| `.area-chip { border: 2px solid #e2e8f0 }` | `#e2e8f0` | `var(--border)` |
| `.area-chip { color: #475569 }` | `#475569` | `var(--text-2)` |
| `.area-chip { background: white }` | `white` | `transparent` |
| `.area-chip:hover { border-color/color: #1A3C4B }` | `#1A3C4B` | `var(--border-hi)` / `var(--text-1)` |
| `.area-chip.activo { border/bg: #1A3C4B }` | `#1A3C4B` | `var(--teal-mid)` / `var(--teal-dim)` |
| `.area-chip.activo { color: white }` | `white` | `var(--teal)` |
| `.filtro-grupo label { color: #64748b }` | `#64748b` | `var(--text-2)` |
| `input[type="date"] { border: 1px solid #d1d5db }` | `#d1d5db` | `var(--border)` |
| `input[type="date"] { border-radius: 6px }` | literal | `var(--radius-md)` |
| `input[type="date"] { background: white }` | `white` | `var(--bg-4)` |
| `input[type="date"]:focus { border-color: #1A3C4B }` | `#1A3C4B` | `var(--border-hi)` |
| `.filtro-panel-btn { border: 1px solid #d1d5db }` | `#d1d5db` | `var(--border)` |
| `.filtro-panel-btn { background: white }` | `white` | `var(--bg-4)` |
| `.filtro-panel-btn { border-radius: 6px }` | literal | `var(--radius-md)` |
| `.filtro-panel-btn:focus { border-color: #1A3C4B }` | `#1A3C4B` | `var(--border-hi)` |
| `.filtro-panel-btn.activo { border-color: #1A3C4B }` | `#1A3C4B` | `var(--border-hi)` |
| `.filtro-panel-btn.activo { background: #f0f7fb }` | `#f0f7fb` | `var(--teal-dim)` |
| `.filtro-panel-dropdown { background: white }` | `white` | `var(--bg-3)` |
| `.filtro-panel-dropdown { border: 1px solid #d1d5db }` | `#d1d5db` | `var(--border)` |
| `.filtro-panel-dropdown { border-radius: 8px }` | literal | `var(--radius-lg)` |
| `.filtro-panel-dropdown { box-shadow: rgba(0,0,0,.1) }` | — | `0 4px 16px rgba(0,0,0,.35)` |
| `.check-item:hover { background: #f8fafc }` | `#f8fafc` | `var(--bg-4)` |
| `.check-item input { accent-color: #1A3C4B }` | `#1A3C4B` | `var(--teal)` |
| `.check-todos { border-bottom: 1px solid #f1f5f9 }` | `#f1f5f9` | `var(--border)` |
| `.btn { ... }` | local | usar `.btn` de design-tokens.css (drop local) |
| `.btn-primary { background: #1A3C4B; color: white }` | local | usar `.btn-primary` de design-tokens.css |
| `.btn-ghost { background: white; color: #374151; border: 1px solid #d1d5db }` | local | renombrar a `.btn-secondary` en HTML + drop local (`.btn-secondary` está en design-tokens.css) |
| `.alerta-error { background: #fef2f2 }` | `#fef2f2` | `var(--red-dim)` |
| `.alerta-error { border: 1px solid #fecaca }` | `#fecaca` | `var(--red-mid)` |
| `.alerta-error { color: #991b1b }` | `#991b1b` | `var(--red)` |
| `th { background: #f8fafc }` | `#f8fafc` | `var(--bg-1)` |
| `th { color: #64748b }` | `#64748b` | `var(--text-3)` |
| `th { border-bottom: 2px solid #e2e8f0 }` | `#e2e8f0` | `var(--border)` |
| `td { border-bottom: 1px solid #f1f5f9 }` | `#f1f5f9` | `var(--border)` |
| `tr:hover td { background: #fafafa }` | `#fafafa` | `var(--bg-4)` |
| `.td-fecha { color: #64748b }` | `#64748b` | `var(--text-2)` |
| `.td-detalle { color: #64748b }` | `#64748b` | `var(--text-2)` |
| `.td-ref { color: #475569 }` | `#475569` | `var(--text-2)` |
| `.accion-*` (8 clases con hex) | varios hex | tokens (ver §4 para cada mapeo) |
| `.pag-info { color: #64748b }` | `#64748b` | `var(--text-2)` |
| `.cargando { color: #94a3b8 }` | `#94a3b8` | `var(--text-3)` |
| `.vacio { color: #94a3b8 }` | `#94a3b8` | `var(--text-3)` |

### Botones `.btn-ghost` → `.btn-secondary`

El HTML estático tiene `<button class="btn btn-ghost">` en 3 lugares:
- Botón "Limpiar" en el card de filtros
- Botón "◀ Anterior" en la paginación
- Botón "Siguiente ▶" en la paginación

El JS no lee la clase `.btn-ghost` (solo lee `.disabled` del `id`). Se puede renombrar sin riesgo.

### Inline en HTML estático

No hay inline styles hardcodeados en el HTML estático de esta página.

### En `rolBadgeHTML()` (bloque `<script>`)

Misma resolución que bloqueos/presencial/dashboard: `.role-badge .role-XXX`.

---

## 7. Nueva estructura HTML objetivo

```
<head>
  <link rel="stylesheet" href="/assets/design-tokens.css">
  <style> … solo lo local que design-tokens.css no cubre … </style>
</head>
<body>

  <div class="app-shell">

    <aside class="sidebar">
      sidebar-header (logo MVLA — idéntico a dashboard.html)
      sidebar-user-card (id="sidebar-avatar")
      sidebar-nav:
        · label "Calendario"
          · Agenda      → /panel/agenda.html
          · Presencial  → /panel/presencial.html
          · Bloqueos    → /panel/bloqueos.html
        · label "Reportes" (id="label-reportes", style="display:none")
          · Auditoría  ← nav-item.active (sin ID — siempre visible aquí)
          · Dashboard   (id="nav-dashboard", style="display:none")
        · label "Admin." (id="label-admin", style="display:none")
          · Usuarios  (id="nav-usuarios",  style="display:none")
          · Servicios (id="nav-servicios", style="display:none")
      sidebar-footer (id="nav-nombre" + btn-logout-sidebar)
    </aside>

    <main class="main-content">
      <div class="page-inner">   ← max-width: 1200px (más ancho que dashboard — tabla de 7 col)

        <div class="page-header">
          <p class="page-supertitle">Panel de gestión</p>
          <h1 class="page-title">Registro de auditoría</h1>
        </div>

        <!-- B9: Selector de área -->
        <div class="area-selector" id="area-selector">
          <div class="area-selector-titulo">Filtrar por área</div>
          <div class="area-chips" id="area-chips"></div>
        </div>

        <!-- Card: Filtros -->
        <div class="card">
          <div class="filtros">
            <div class="filtro-grupo">
              <label>Desde</label>
              <input type="date" id="filtro-desde">
            </div>
            <div class="filtro-grupo">
              <label>Hasta</label>
              <input type="date" id="filtro-hasta">
            </div>
            <div class="filtro-grupo">
              <label>Usuario</label>
              <div class="filtro-panel" id="panel-usuarios">
                <button class="filtro-panel-btn" onclick="togglePanel('panel-usuarios')">
                  <span id="lbl-usuarios">Todos</span>
                  <span class="filtro-panel-caret">▼</span>
                </button>
                <div class="filtro-panel-dropdown" id="drop-usuarios">
                  <label class="check-item check-todos">
                    <input type="checkbox" id="chk-todos-usuarios" checked onchange="toggleTodos('usuarios')"> Todos
                  </label>
                  <div id="lista-usuarios"></div>
                </div>
              </div>
            </div>
            <div class="filtro-grupo">
              <label>Acción</label>
              <div class="filtro-panel" id="panel-acciones">
                <button class="filtro-panel-btn" onclick="togglePanel('panel-acciones')">
                  <span id="lbl-acciones">Todas</span>
                  <span class="filtro-panel-caret">▼</span>
                </button>
                <div class="filtro-panel-dropdown" id="drop-acciones">
                  <label class="check-item check-todos">
                    <input type="checkbox" id="chk-todos-acciones" checked onchange="toggleTodos('acciones')"> Todas
                  </label>
                  <div id="lista-acciones"></div>
                </div>
              </div>
            </div>
            <div class="filtro-grupo">
              <label>Entidad</label>
              <div class="filtro-panel" id="panel-entidades">
                <button class="filtro-panel-btn" onclick="togglePanel('panel-entidades')">
                  <span id="lbl-entidades">Todas</span>
                  <span class="filtro-panel-caret">▼</span>
                </button>
                <div class="filtro-panel-dropdown" id="drop-entidades">
                  <label class="check-item check-todos">
                    <input type="checkbox" id="chk-todos-entidades" checked onchange="toggleTodos('entidades')"> Todas
                  </label>
                  <div id="lista-entidades"></div>
                </div>
              </div>
            </div>
            <button class="btn btn-primary"   onclick="buscar()">Buscar</button>
            <button class="btn btn-secondary" onclick="limpiarFiltros()">Limpiar</button>
          </div>
        </div>

        <div class="alerta alerta-error" id="alerta-error"></div>

        <!-- Card: Tabla -->
        <div class="card">
          <div class="tabla-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Fecha/hora</th>
                  <th>Usuario</th>
                  <th>Acción</th>
                  <th>Entidad</th>
                  <th>Referencia</th>
                  <th>Canal</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody id="tbody"></tbody>
            </table>
            <div id="estado-carga" class="cargando">Cargando registros...</div>
          </div>
          <div class="paginacion">
            <span class="pag-info" id="pag-info"></span>
            <div class="pag-botones">
              <button class="btn btn-secondary" id="btn-anterior" onclick="irPagina(paginaActual - 1)" disabled>◀ Anterior</button>
              <button class="btn btn-secondary" id="btn-siguiente" onclick="irPagina(paginaActual + 1)" disabled>Siguiente ▶</button>
            </div>
          </div>
        </div>

      </div><!-- .page-inner -->
    </main>

  </div><!-- .app-shell -->

  <script> … idéntico al actual excepto rolBadgeHTML() e init() … </script>

</body>
```

> **Nota sobre `.area-selector`:** el HTML actual combina `class="area-selector card"`.
> En el nuevo HTML, el selector de área NO lleva `.card` — es un componente independiente
> con su propio estilo, igual que en dashboard.html.

> **Nota sobre botones:** `btn-ghost` → `btn-secondary` en el HTML estático.
> El JS no lee esta clase CSS, solo lee el `id` de los botones de paginación.

---

## 8. CSS nuevo para el `<style>` interno

Solo lo que design-tokens.css no cubre. Todos los colores en vars.

```css
/* ══════════════════════════════════════════════════════════════
   auditoria.html — estilos locales (design system C+)
   Todos los colores vienen de design-tokens.css.
══════════════════════════════════════════════════════════════ */

/* ── Layout shell ────────────────────────────────────────────── */
.app-shell    { display: flex; height: 100vh; overflow: hidden; }
.main-content { flex: 1; overflow-y: auto; background: var(--bg-2); }
.page-inner   { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem; }

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

/* ── Sidebar (copiado de dashboard.html) ─────────────────────── */
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

/* ── Selector de área B9 ─────────────────────────────────────── */
.area-selector { display: none; margin-bottom: 1rem; }
.area-selector.visible { display: block; }
.area-selector-titulo {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-3);
  margin-bottom: 0.4rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.area-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.area-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 99px;
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-2);
  background: transparent;
  transition: var(--transition-fast);
  user-select: none;
}
.area-chip:hover  { border-color: var(--border-hi); color: var(--text-1); }
.area-chip.activo { border-color: var(--teal-mid); background: var(--teal-dim); color: var(--teal); font-weight: 600; }

/* ── Filtros ─────────────────────────────────────────────────── */
.filtros { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; }
.filtro-grupo { display: flex; flex-direction: column; gap: 0.3rem; }
.filtro-grupo label {
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-2);
}
input[type="date"] {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  font-family: var(--font-ui);
  background: var(--bg-4);
  color: var(--text-1);
  cursor: pointer;
  transition: var(--transition-fast);
}
input[type="date"]:focus { outline: none; border-color: var(--border-hi); }

/* ── Paneles de checkboxes B7 ────────────────────────────────── */
.filtro-panel { position: relative; }
.filtro-panel-btn {
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  font-family: var(--font-ui);
  background: var(--bg-4);
  color: var(--text-2);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 120px;
  transition: var(--transition-fast);
}
.filtro-panel-btn:focus { outline: none; border-color: var(--border-hi); }
.filtro-panel-btn:hover { border-color: var(--border-hi); color: var(--text-1); }
.filtro-panel-btn.activo { border-color: var(--border-hi); background: var(--teal-dim); color: var(--teal); }
.filtro-panel-caret { font-size: 0.6rem; margin-left: auto; }
.filtro-panel-dropdown {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 100;
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  min-width: 180px;
  max-height: 240px;
  overflow-y: auto;
  box-shadow: 0 4px 16px rgba(0,0,0,.35);
  padding: 0.25rem 0;
}
.filtro-panel-dropdown.abierto { display: block; }
.check-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
  font-size: var(--text-base);
  color: var(--text-1);
}
.check-item:hover { background: var(--bg-4); }
.check-item input[type="checkbox"] { accent-color: var(--teal); cursor: pointer; }
.check-todos { border-bottom: 1px solid var(--border); font-weight: 600; }

/* ── Alerta ──────────────────────────────────────────────────── */
.alerta {
  padding: 0.7rem 1rem;
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  margin-bottom: 1rem;
  display: none;
}
.alerta.visible { display: block; }
.alerta-error {
  background: var(--red-dim);
  border: 1px solid var(--red-mid);
  color: var(--red);
}

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
td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
  font-size: var(--text-base);
  color: var(--text-1);
}
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--bg-4); }
.td-fecha { white-space: nowrap; color: var(--text-2); }
.td-detalle { max-width: 280px; word-break: break-word; color: var(--text-2); font-size: var(--text-sm); }
.td-ref { max-width: 160px; font-style: italic; color: var(--text-2); }

/* ── Badges de acción ────────────────────────────────────────── */
/* No se usan .audit-badge/.audit-* porque el JS genera .badge-accion.accion-* */
/* con nombres en español. Ver §4 para el análisis completo del mismatch.      */
.badge-accion {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 20px;
  font-size: var(--text-xs);
  font-weight: 600;
  font-family: var(--font-ui);
}
.accion-crear       { color: var(--teal);   background: rgba(45,212,160,.18);  border: 1px solid rgba(45,212,160,.44);  }
.accion-modificar   { color: var(--blue);   background: rgba(75,168,248,.18);  border: 1px solid rgba(75,168,248,.44);  }
.accion-cancelar    { color: var(--red);    background: rgba(245,104,104,.18); border: 1px solid rgba(245,104,104,.44); }
.accion-eliminar    { color: var(--red);    background: rgba(245,104,104,.18); border: 1px solid rgba(245,104,104,.44); }
.accion-bloquear    { color: var(--amber);  background: rgba(245,165,42,.18);  border: 1px solid rgba(245,165,42,.44);  }
.accion-desbloquear { color: var(--text-2); background: rgba(110,144,171,.18); border: 1px solid rgba(110,144,171,.44); }
.accion-login       { color: var(--text-2); background: rgba(110,144,171,.18); border: 1px solid rgba(110,144,171,.44); }
.accion-logout      { color: var(--text-2); background: rgba(110,144,171,.18); border: 1px solid rgba(110,144,171,.44); }

/* ── Paginación ──────────────────────────────────────────────── */
.paginacion {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 0 0;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.pag-info { font-size: var(--text-base); color: var(--text-2); }
.pag-botones { display: flex; gap: 0.4rem; }

/* ── Carga y vacío ───────────────────────────────────────────── */
.cargando { text-align: center; color: var(--text-3); padding: 3rem; font-style: italic; }
.vacio    { text-align: center; color: var(--text-3); padding: 3rem; }
```

---

## 9. Cambios en el bloque `<script>`

### `rolBadgeHTML()` — mismo cambio que en todos los otros paneles

```javascript
// ANTES (inline styles hardcodeados):
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

// DESPUÉS (clases del design system):
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

### `init()` — agregar bloque de sidebar-avatar y labels de sección

Agregar **después** de `nombreEl.innerHTML = ...` (igual que en dashboard.html):

```javascript
// Sidebar avatar: iniciales + color según rol (copiado de dashboard.html)
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

> El forEach existente que muestra `nav-dashboard`, `nav-usuarios`, `nav-servicios` se mantiene
> sin cambios — esos tres IDs existen en el sidebar nuevo con `style="display:none"`.

---

## 10. Verificaciones de cierre (Paso 2 y 3)

### Paso 2 — Clases generadas por JS

- ¿Existe `.area-chip` y `.area-chip.activo` en el CSS?
- ¿Existe `.filtro-panel-btn.activo` en el CSS?
- ¿Existe `.filtro-panel-dropdown.abierto` en el CSS?
- ¿Existe `.check-item` en el CSS?
- ¿Existe `.alerta { display: none }` y `.alerta.visible { display: block }`?
- ¿Existen `.badge-accion` y las 8 clases `.accion-*`?
- ¿Existen `.cargando` y `.vacio`?

### Paso 3 — Certificación

- grep: 0 hex en `<style>`
- grep: 0 hex en HTML estático
- `.navbar`, `.nav-links`, `.nav-user`, `.btn-logout`, `.badge-rol`, `.btn-ghost` → 0 en `<style>`
- `rolBadgeHTML()` usa solo `role-badge ${cls}` sin hex ni `style=`
- Hex count en `<script>` = 3 líneas (líneas 501, 505, 509 — exclusiones §5)
- `btn-ghost` → `btn-secondary` en los 3 lugares del HTML

---

## 11. Orden de implementación

### Paso 1 — Layout shell, sidebar, CSS completo + ajustes de JS ✅ completado — 2026-06-26

- Agregar `<link rel="stylesheet" href="/assets/design-tokens.css">` en el `<head>`
- Reemplazar `<nav class="navbar">` y todo su CSS por el sidebar de dashboard.html
- Cambiar `.nav-item.active` al ítem "Auditoría" (no "Dashboard")
- En sidebar: `id="sidebar-avatar"`, `id="label-reportes"` (display:none), `id="label-admin"` (display:none)
- Dashboard y los demás ítems ocultos: `id="nav-dashboard"` (display:none), `id="nav-usuarios"` (display:none), `id="nav-servicios"` (display:none)
- Quitar `class="card"` del área-selector: `<div class="area-selector card" id="area-selector">` → `<div class="area-selector" id="area-selector">`
- Renombrar `btn-ghost` → `btn-secondary` en los 3 botones del HTML estático
- Wrap del contenido en `.app-shell > .main-content > .page-inner`
- HTML: `.page-header` con "Panel de gestión" / "Registro de auditoría"
- CSS: incluir **todo el CSS del §8** en este paso
- **JS `rolBadgeHTML()`:** reescribir con `.role-badge .role-XXX`
- **JS `init()`:** agregar bloque `sidebar-avatar` + `lRep`/`lAdm` copiando de dashboard.html

**Verificaciones ejecutadas 2026-06-26 — 6/6 PASS:**
1. ✅ 0 hex en `<style>` — 0 ocurrencias
2. ✅ 0 hex en HTML estático — 0 ocurrencias
3. ✅ Hex en `<script>` = exactamente 3 líneas (líneas 664, 668, 672 — exclusiones §5)
4. ✅ Los 32 IDs del §1 presentes en el DOM
5. ✅ `btn-ghost` → `btn-secondary` — 0 ocurrencias de `btn-ghost`
6. ✅ `rolBadgeHTML()` sin inline styles — usa `.role-badge .role-${cls}`

### Paso 2 — Verificación de clases generadas por JS ✅ completado — 2026-06-26

- Confirmar que `.area-chip` y `.area-chip.activo` están en CSS
- Confirmar que `.filtro-panel-btn.activo` y `.filtro-panel-dropdown.abierto` están en CSS
- Confirmar que `.check-item` está en CSS
- Confirmar que `.alerta { display: none }` y `.alerta.visible { display: block }` están en CSS
- Confirmar que `.badge-accion` y las 8 clases `.accion-*` están en CSS
- Confirmar que `.cargando` y `.vacio` están en CSS

**Verificaciones ejecutadas 2026-06-26 — 7/7 PASS:**
1. ✅ `.area-chip` (L71) y `.area-chip.activo` (L87) — presentes en CSS
2. ✅ `.filtro-panel-btn` (L112) y `.filtro-panel-btn.activo` (L129) — presentes en CSS
3. ✅ `.filtro-panel-dropdown` (L131) y `.filtro-panel-dropdown.abierto` (L146) — presentes en CSS
4. ✅ `.check-item` (L147) con `display:flex` + checkbox + label — presente en CSS
5. ✅ `.alerta { display: none }` (L161–167) y `.alerta.visible { display: block }` (L168) — presentes
6. ✅ `.badge-accion` (L207) + 8 clases `.accion-*` (L215–222) — todas presentes con tokens
7. ✅ `.cargando` (L237) y `.vacio` (L238) — presentes con `var(--text-3)`
8. ✅ `badgeAccion()` genera exactamente `badge-accion accion-${esc(accion)}` (L456) — sin variaciones
9. ✅ `togglePanel()` usa `classList.add('abierto')` / `classList.remove('abierto')` (L535–536) — correcto

### Paso 3 — Certificación final

- grep: 0 hex en `<style>` (excepto rgba de accion-* — verificar que son los correctos del §4)
- grep: 0 hex en HTML estático
- `.navbar`, `.btn-logout`, `.badge-rol`, `.btn-ghost` → 0 en `<style>`
- `rolBadgeHTML()` usa solo `role-badge ${cls}` sin hex ni `style=`
- Hex count en script = 3 (líneas con `style="color:..."` de las exclusiones §5)
- **Verificado:** rediseño completo

### Commit
Un único commit: `feat(panel): auditoria — rediseño design system C+`
