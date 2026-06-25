# Plan de rediseño — dashboard.html
# Referencia: design_handoff_sistema_turnos/README.md § tokens globales
# Restricciones: Vanilla JS · no tocar lógica JS · solo vars de design-tokens.css

---

## Contexto: página de analíticas, con gráficos SVG generados por JS

`dashboard.html` es la pantalla de estadísticas. A diferencia de bloqueos o presencial,
contiene dos funciones de gráficos SVG (`svgTorta`, `svgBarras`) y una función de render
compleja (`renderDashboard`) que inyecta la totalidad del contenido en `#contenido`.

Esto agrega una restricción extra: varios colores hardcodeados están dentro del `<script>`
como constantes de visualización o parámetros de gráficos. Esos colores son **lógica de
presentación de datos** (no decoración), y quedan **excluidos explícitamente** del
rediseño (ver §3 y §4).

---

## 1. Inventario de IDs obligatorios

Estos IDs son leídos o escritos por el JS y deben sobrevivir intactos.

### Sidebar — inicialización por `init()`

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `nav-nombre` | `init()` | inyecta `nombre + rolBadgeHTML()` |
| `sidebar-avatar` | `init()` | iniciales del usuario + fondo/color según rol (**no existe en el `init()` actual — hay que agregarlo**, igual que en presencial.html y bloqueos.html) |
| `nav-auditoria` | `init()` | muestra/oculta via `style.display` |
| `nav-usuarios` | `init()` | muestra/oculta via `style.display` |
| `nav-servicios` | `init()` | muestra/oculta via `style.display` |
| `label-reportes` | `init()` | muestra label de sección según rol (**no existe en el `init()` actual — hay que agregarlo**) |
| `label-admin` | `init()` | muestra label de sección según rol (**no existe en el `init()` actual — hay que agregarlo**) |

> **Nota:** El link "Dashboard" en el sidebar NO necesita ID dinámico: como el usuario ya
> superó el chequeo de rol al llegar a esta página, se hardcodea como `.nav-item.active`
> directamente en el HTML. No hay un `nav-dashboard` que mostrar/ocultar.

> **Nota:** El `init()` actual no puebla `sidebar-avatar` ni muestra `label-reportes` /
> `label-admin`. Deben agregarse al HTML del sidebar y a la lógica de `init()`, copiando
> exactamente el código de presencial.html / bloqueos.html.

### Selector de período

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `campos-custom` | `elegirPeriodo()` | agrega/quita clase `.visible` |
| `custom-desde` | `aplicarCustom()` | `.value` leído |
| `custom-hasta` | `aplicarCustom()` | `.value` leído |

> `id="btn-mes"` está en el HTML del botón "Último mes" pero **no es leído por ninguna
> función JS**. Se mantiene en el HTML tal como está (sin consecuencias).

### Chips de área (B9)

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `selector-areas-dash` | `inicializarChipsDash()` | agrega `.visible` para mostrar el bloque |
| `chips-areas-dash` | `inicializarChipsDash()`, `areasParam()` | inserta `<span class="area-chip">` dinámicamente; lee `.area-chip.activo` para armar la URL |

### Contenido y alertas

| ID | Quién lo usa | Qué hace |
|---|---|---|
| `alerta-error` | `mostrarError()` | `.textContent` + toggle `.visible` |
| `contenido` | `cargar()`, `renderDashboard()` | `.innerHTML` — reemplazado con la tarjeta de carga o el HTML completo del dashboard |

---

## 2. Clases CSS generadas dinámicamente por JS

Estas clases son inyectadas vía `.innerHTML` o `.className` — deben existir en el CSS nuevo.

### Por `inicializarChipsDash()`:
- `.area-chip` — chip de área (base)
- `.area-chip.activo` — chip seleccionado

### Por `mostrarError()`:
- `.alerta.visible` — toggle de `display: block` sobre `.alerta`

### Por `cargar()` en `#contenido` (estado de espera):
- `.card cargando` — tarjeta "Cargando estadísticas..."

### Por `renderDashboard()` en `#contenido` (contenido final):
- `.grid-2` — grilla de 2 columnas para cards
- `.card` — tarjeta blanca contenedora
- `.card-titulo` — título de sección dentro de card
- `.tabla-estados` — tabla de turnos por estado
- `.dot` — punto de color (indicador de estado o canal)
- `.num` — número alineado a la derecha en tablas
- `.stat-grande` — contenedor del stat centrado (tasa ausentismo)
- `.stat-numero` — número grande (porcentaje de ausentismo)
- `.stat-label` — texto descriptivo bajo el número
- `.leyenda` — contenedor de ítems de leyenda del gráfico
- `.leyenda-item` — un ítem de leyenda (dot + label + valor)
- `.tabla-op` — tabla de operadores top
- `.pos` — número de posición (1°, 2°...) en tabla operadores
- `.vacio` — mensaje "Sin datos para el período." (generado por `svgTorta` y `svgBarras`)

### Por `rolBadgeHTML()` — PRESENTACIÓN, a reemplazar:
- `.badge-rol` + inline `style="background:${bg};color:white"` → a reemplazar por `.role-badge .role-XXX` (igual que bloqueos.html)

---

## 3. Funciones JS: presentación vs. lógica

### Lógica de negocio — NO MODIFICAR

| Función | Por qué no se toca |
|---|---|
| `getToken()`, `getUsuario()`, `apiFetch()`, `cerrarSesion()` | Auth |
| `inicializarChipsDash()` | construcción de chips con handlers de filtrado |
| `areasParam()` | lee estado de chips, construye query string |
| `esc()` | sanitización de HTML |
| `mostrarError()` | lógica de estado de alertas |
| `rangoFechas()` | cálculo de fechas por período |
| `elegirPeriodo()` | actualiza estado y llama a `cargar()` |
| `aplicarCustom()` | validación de fechas + llama a `cargar()` |
| `cargar()` | fetch al endpoint + dispatch a `renderDashboard()` |
| `renderDashboard()` | procesa datos + construye todo el HTML del dashboard |
| `init()` | bootstrap async de la página |

### Gráficos SVG — EXCLUIR del rediseño

Estas funciones generan SVG puro. Los colores que usan son **datos de visualización**,
no decoración. No se tocan ni sus cuerpos ni sus llamadas.

| Función | Por qué se excluye |
|---|---|
| `svgTorta(datos, radio)` | genera SVG de torta; el color de cada sector viene de `COLORES_CANAL` via el parámetro `datos[i].color` |
| `svgBarras(datos, alto, color)` | genera SVG de barras; el color de las barras viene del parámetro `color`; internamente usa hexadecimales para las etiquetas de eje |

### Presentación — SE PUEDE REESCRIBIR (solo el HTML que genera)

| Función | Qué se puede cambiar |
|---|---|
| `rolBadgeHTML()` | Reemplaza estilos inline hardcodeados por `.role-badge .role-XXX`. La firma y el return de HTML no cambian. |

---

## 4. Exclusiones explícitas del rediseño — colores en `<script>`

Estos hexadecimales están dentro del bloque `<script>` y **deben permanecer intactos**.

### Constantes de color de visualización (líneas 259, 335–337)

```javascript
// Colores de canal — identidad visual de cada origen de turno
const COLORES_CANAL = { whatsapp: '#25d366', web: '#3b82f6', presencial: '#f59e0b' };

// Colores de estado — escala semafórica de estados de turno
const COLORES_ESTADO = {
  agendado: '#93c5fd', presente: '#86efac', atendido: '#d1d5db',
  ausente: '#fca5a5', cancelado: '#e2e8f0'
};
```

Estas constantes mapean valores de dominio a colores específicos. Son lógica de
presentación de datos, no tokens de UI.

### Parámetros de color en llamadas a `svgBarras()` (líneas 388 y 395–396)

```javascript
svgBarras(diasData,   130, '#1A3C4B')   // gráfico de día de semana — barras oscuras
svgBarras(semanasData, 150, '#3b82f6')  // gráfico de evolución semanal — barras azules
```

Determinar el color de cada gráfico de barras es lógica de diseño de la visualización.

### Colores internos de `svgBarras()` (líneas 314 y 319)

```javascript
fill="#94a3b8"   // color de etiquetas del eje X
fill="#374151"   // color de valores encima de cada barra
```

Son atributos SVG hardcodeados dentro de la función de renderizado del gráfico.

### Color interno de `svgTorta()` (línea 282)

```javascript
stroke="white"   // separador blanco entre sectores de la torta
```

### Colores inline en template strings de `renderDashboard()` — DEJAR INTACTOS

```javascript
// Condicional por valor de dato (línea 423) — es LÓGICA, no decoración:
style="color:${parseFloat(tasa) > 20 ? '#dc2626' : '#1A3C4B'}"

// Inline styles estáticos en template strings (líneas 354, 405, 409, 432–434):
style="color:#94a3b8;text-align:right"          // columna de porcentaje en tabla-estados
style="margin-top:.75rem;font-size:.78rem;color:#64748b"   // "Total del período"
style="display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap"  // layout canal card
style="font-size:.72rem;color:#64748b;padding:.4rem .5rem;border-bottom:1px solid #e2e8f0"  // × 3 en TH de tabla-op
```

Estos inline styles están embebidos en los template literals de `renderDashboard()`.
Se excluyen del rediseño con el mismo criterio que los inline styles de `cargarBloqueos()`
en bloqueos.html: modificar esas cadenas implicaría tocar la lógica de la función.

---

## 5. Mapeo de colores hardcodeados → tokens

### CSS en `<style>` interno

| Contexto | Valor actual | Token equivalente |
|---|---|---|
| Body bg | `#f1f5f9` | ya cubierto por design-tokens.css |
| Body color | `#1e293b` | ya cubierto por design-tokens.css |
| Body font | `system-ui, -apple-system, 'Segoe UI'` | ya cubierto por design-tokens.css |
| `.navbar { background: #1A3C4B }` | eliminado | → reemplazado por sidebar |
| `.nav-links`, `.nav-user`, `.btn-logout`, `.badge-rol` | eliminados | → reemplazados por sidebar y `.role-badge` |
| `h1 { color: #1A3C4B }` | eliminado | → reemplazado por `.page-title` |
| `.card { background: white }` | `white` | `var(--bg-3)` |
| `.card { box-shadow: rgba(0,0,0,.08) }` | — | `0 0 0 1px var(--border)` |
| `.card-titulo { color: #1A3C4B }` | `#1A3C4B` | `var(--text-1)` |
| `.card-titulo { font-family: 'Trebuchet MS' }` | Trebuchet | `var(--font-ui)` |
| `.btn-group-periodo { border: 1px solid #d1d5db }` | `#d1d5db` | `var(--border)` |
| `.btn-periodo { background: white }` | `white` | `var(--bg-3)` |
| `.btn-periodo { color: #374151 }` | `#374151` | `var(--text-2)` |
| `.btn-periodo { border-right: 1px solid #d1d5db }` | `#d1d5db` | `var(--border)` |
| `.btn-periodo.activo { background: #1A3C4B; color: white }` | `#1A3C4B` | `var(--teal-dim)` / `var(--teal-mid)` / `var(--teal)` |
| `.btn-periodo:hover { background: #f8fafc }` | `#f8fafc` | `var(--bg-4)` |
| `input[type="date"] { border: 1px solid #d1d5db }` | `#d1d5db` | `var(--border)` |
| `input[type="date"] { border-radius: 6px }` | literal | `var(--radius-md)` |
| `input[type="date"]:focus { border-color: #1A3C4B }` | `#1A3C4B` | `var(--border-hi)` |
| `.btn-primary { background: #1A3C4B; color: white }` | — | usar `.btn.btn-primary` de tokens |
| `.stat-numero { color: #1A3C4B }` | `#1A3C4B` | `var(--teal)` |
| `.stat-numero { font-family: 'Trebuchet MS' }` | Trebuchet | `var(--font-mono)` (DM Mono — para KPIs) |
| `.stat-numero { font-size: 2.5rem }` | literal | `var(--text-kpi)` (38px, ya con font-mono en la clase utilitaria) |
| `.stat-label { color: #64748b }` | `#64748b` | `var(--text-2)` |
| `.tabla-estados td { border-bottom: 1px solid #f1f5f9 }` | `#f1f5f9` | `var(--border)` |
| `.tabla-op td { border-bottom: 1px solid #f1f5f9 }` | `#f1f5f9` | `var(--border)` |
| `.tabla-op .num { color: #1A3C4B }` | `#1A3C4B` | `var(--teal)` |
| `.tabla-op .pos { color: #94a3b8 }` | `#94a3b8` | `var(--text-3)` |
| `.alerta-error { background: #fef2f2 }` | `#fef2f2` | `var(--red-dim)` |
| `.alerta-error { border: 1px solid #fecaca }` | `#fecaca` | `var(--red-mid)` |
| `.alerta-error { color: #991b1b }` | `#991b1b` | `var(--red)` |
| `.cargando { color: #94a3b8 }` | `#94a3b8` | `var(--text-3)` |
| `.vacio { color: #94a3b8 }` | `#94a3b8` | `var(--text-3)` |
| `.leyenda-item { color: #374151 }` | `#374151` | `var(--text-2)` |
| `.area-chip { border: 2px solid #e2e8f0; color: #475569 }` | claros | `var(--border)` / `var(--text-2)` |
| `.area-chip:hover { border-color: #1A3C4B; color: #1A3C4B }` | `#1A3C4B` | `var(--border-hi)` / `var(--text-1)` |
| `.area-chip.activo { border/bg: #1A3C4B; color: white }` | `#1A3C4B` | `var(--teal-mid)` / `var(--teal-dim)` / `var(--teal)` |
| `.area-selector-titulo { color: #64748b }` | `#64748b` | `var(--text-3)` |

### Inline en HTML estático

| Elemento | Style inline actual | Solución |
|---|---|---|
| `<span style="color:#64748b">—</span>` (separador de fechas, línea 129) | color hardcoded | `<span class="fecha-sep">—</span>` + `.fecha-sep { color: var(--text-3); }` |
| `style="display:none"` en nav links del navbar | control de visibilidad por JS | MANTENER — los nav links del sidebar usan el mismo patrón |

### En `rolBadgeHTML()` (bloque `<script>`)

| Rol | bg hardcoded | Solución |
|---|---|---|
| operador | `#1e40af` (azul) | `.role-badge .role-operador` |
| encargado | `#166534` (verde) | `.role-badge .role-encargado` |
| sistemas | `#6b21a8` (violeta) | `.role-badge .role-sistemas` |
| directivo | `#374151` (gris) | `.role-badge .role-directivo` |

---

## 6. Qué cubre design-tokens.css (no hay que redefinir)

| Uso | Clase/token de design-tokens.css |
|---|---|
| Botón "Aplicar" período custom | `.btn.btn-primary` |
| Badge de rol en sidebar footer | `.role-badge .role-encargado/.role-operador/.role-sistemas/.role-directivo` |
| Nav items del sidebar | `.nav-item`, `.nav-item.active` |
| Reset global, font, bg/color del body | ya en `html, body { ... }` de design-tokens.css |
| Escala tipográfica KPI | `--text-kpi: 38px` (definido en `:root`); `.text-kpi` (clase utilitaria con font-mono + 800) |

> **Nota:** design-tokens.css define `.kpi-card`, `.kpi-label`, `.kpi-number` (líneas 472–494).
> Sin embargo, el JS inyecta sus propias clases (`.stat-grande`, `.stat-numero`, `.stat-label`)
> en `renderDashboard()`. Esas clases del JS no pueden cambiarse → se definen localmente
> en el `<style>` interno apuntando a los mismos tokens.

---

## 7. Nueva estructura HTML objetivo

```
<head>
  <link rel="stylesheet" href="/assets/design-tokens.css">
  <style> … solo lo local que design-tokens.css no cubre … </style>
</head>
<body>

  <div class="app-shell">          ← flex, height:100vh, overflow:hidden

    <aside class="sidebar">        ← copiado íntegro de bloqueos.html / presencial.html
      sidebar-header (logo MVLA)
      sidebar-user-card (id="sidebar-avatar" — iniciales + color según rol)
      sidebar-nav:
        · label "Calendario"
          · Agenda      → /panel/agenda.html
          · Presencial  → /panel/presencial.html
          · Bloqueos    → /panel/bloqueos.html
        · label "Reportes" (id="label-reportes", style="display:none" por defecto)
          · Auditoría (id="nav-auditoria", style="display:none")
          · Dashboard ← nav-item.active  (sin ID — siempre visible en esta página)
        · label "Administración" (id="label-admin", style="display:none" por defecto)
          · Usuarios  (id="nav-usuarios",  style="display:none")
          · Servicios (id="nav-servicios", style="display:none")
      sidebar-footer (id="nav-nombre" + btn-logout-sidebar)
    </aside>

    <main class="main-content">   ← flex:1, overflow-y:auto, background:var(--bg-2)

      <div class="page-inner">    ← max-width:1100px, margin:auto, padding:2rem 1.5rem
                                    (1100px en vez de 900px — dashboard tiene grillas anchas)

        <div class="page-header">
          <p class="page-supertitle">Panel de gestión</p>
          <h1 class="page-title">Dashboard</h1>
        </div>

        <!-- Card: selector de período -->
        <div class="card">
          <div class="periodo-bar">
            <div class="btn-group-periodo">
              <button class="btn-periodo" onclick="elegirPeriodo('semana')">Última semana</button>
              <button class="btn-periodo activo" id="btn-mes" onclick="elegirPeriodo('mes')">Último mes</button>
              <button class="btn-periodo" onclick="elegirPeriodo('trimestre')">Últimos 3 meses</button>
              <button class="btn-periodo" onclick="elegirPeriodo('custom')">Personalizado</button>
            </div>
            <div class="campos-custom" id="campos-custom">
              <input type="date" id="custom-desde">
              <span class="fecha-sep">—</span>
              <input type="date" id="custom-hasta">
              <button class="btn btn-primary" onclick="aplicarCustom()">Aplicar</button>
            </div>
          </div>
        </div>

        <!-- B9: chips de área -->
        <div class="area-selector" id="selector-areas-dash">
          <div class="area-selector-titulo">Filtrar por área</div>
          <div class="area-chips" id="chips-areas-dash"></div>
        </div>

        <div class="alerta alerta-error" id="alerta-error"></div>

        <div id="contenido">
          <div class="card cargando">Cargando estadísticas...</div>
        </div>

      </div><!-- .page-inner -->
    </main>

  </div><!-- .app-shell -->

  <script> … idéntico al actual excepto rolBadgeHTML() y bloque de init() … </script>

</body>
```

---

## 8. CSS nuevo para el `<style>` interno

Solo lo que design-tokens.css no cubre. Usar únicamente vars.

```css
/* ── Layout ─────────────────────────────────────────────────── */
.app-shell    { display: flex; height: 100vh; overflow: hidden; }
.main-content { flex: 1; overflow-y: auto; background: var(--bg-2); }
.page-inner   { max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem; }

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

/* ── Card ────────────────────────────────────────────────────── */
.card {
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1.25rem 1.5rem;
  margin-bottom: 1rem;
}
.card-titulo {
  font-family: var(--font-ui);
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--text-1);
  margin-bottom: 1rem;
}

/* ── Selector de período ─────────────────────────────────────── */
.periodo-bar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.btn-group-periodo {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.btn-periodo {
  background: var(--bg-3);
  border: none;
  border-right: 1px solid var(--border);
  padding: 0.38rem 0.9rem;
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-2);
  font-family: var(--font-ui);
  transition: var(--transition-fast);
}
.btn-periodo:last-child { border-right: none; }
.btn-periodo.activo {
  background: var(--teal-dim);
  border-color: var(--teal-mid);
  color: var(--teal);
  font-weight: 600;
}
.btn-periodo:hover:not(.activo) { background: var(--bg-4); color: var(--text-1); }

/* ── Campos de fecha personalizada ───────────────────────────── */
.campos-custom { display: none; align-items: center; gap: 0.5rem; }
.campos-custom.visible { display: flex; }
.fecha-sep { color: var(--text-3); }
input[type="date"] {
  padding: 0.38rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-family: var(--font-ui);
  background: var(--bg-4);
  color: var(--text-1);
  cursor: pointer;
  transition: var(--transition-fast);
}
input[type="date"]:focus { outline: none; border-color: var(--border-hi); }

/* ── Grillas de métricas ─────────────────────────────────────── */
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
@media (max-width: 720px) { .grid-2, .grid-3 { grid-template-columns: 1fr; } }

/* ── Stat grande (tasa de ausentismo) ────────────────────────── */
.stat-grande { text-align: center; padding: 0.5rem 0; }
.stat-numero {
  font-family: var(--font-mono);
  font-size: var(--text-kpi);
  font-weight: 800;
  color: var(--teal);   /* el inline style del JS lo puede sobreescribir condicionalmente */
  line-height: 1;
}
.stat-label { font-size: var(--text-sm); color: var(--text-2); margin-top: 0.3rem; }

/* ── Tabla de estados ────────────────────────────────────────── */
.tabla-estados { width: 100%; border-collapse: collapse; }
.tabla-estados td {
  padding: 0.5rem;
  border-bottom: 1px solid var(--border);
  font-size: var(--text-base);
}
.tabla-estados tr:last-child td { border-bottom: none; }
.tabla-estados .num { font-weight: 700; text-align: right; }

/* ── Dot de color (indicador de estado/canal) ────────────────── */
/* El color real viene del inline style del JS (datos de visualización) */
.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-right: 0.4rem;
  flex-shrink: 0;
}

/* ── Leyenda del gráfico de torta ────────────────────────────── */
.leyenda { margin-top: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.leyenda-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--text-sm);
  color: var(--text-2);
}

/* ── Tabla de operadores ─────────────────────────────────────── */
.tabla-op { width: 100%; border-collapse: collapse; }
.tabla-op td {
  padding: 0.45rem 0.5rem;
  border-bottom: 1px solid var(--border);
  font-size: var(--text-base);
}
.tabla-op tr:last-child td { border-bottom: none; }
.tabla-op .num { font-weight: 700; color: var(--teal); text-align: right; }
.tabla-op .pos { color: var(--text-3); font-size: var(--text-xs); width: 24px; }

/* ── Alerta de error ─────────────────────────────────────────── */
.alerta {
  padding: 0.7rem 1rem;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  margin-bottom: 1rem;
  display: none;
}
.alerta.visible { display: block; }
.alerta-error {
  background: var(--red-dim);
  border: 1px solid var(--red-mid);
  color: var(--red);
}

/* ── Estados de carga y vacío ────────────────────────────────── */
.cargando { text-align: center; color: var(--text-3); padding: 2rem; font-style: italic; }
.vacio    { text-align: center; color: var(--text-3); padding: 1.5rem; font-size: var(--text-sm); }

/* ── Selector de área (B9) ───────────────────────────────────── */
.area-selector { margin-bottom: 1rem; display: none; }
.area-selector.visible { display: block; }
.area-selector-titulo {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.4rem;
}
.area-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.area-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  border: 1px solid var(--border);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  color: var(--text-2);
  background: transparent;
  transition: var(--transition-fast);
  user-select: none;
}
.area-chip:hover  { background: var(--bg-4); border-color: var(--border-hi); color: var(--text-1); }
.area-chip.activo { background: var(--teal-dim); border-color: var(--teal-mid); color: var(--teal); font-weight: 600; }

/* ── Sidebar (copiado de bloqueos.html / presencial.html) ───── */
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
```

---

## 9. Cambios en el bloque `<script>`

### `rolBadgeHTML()` — mismo cambio que en bloqueos.html

```javascript
// ANTES (hardcoded inline styles):
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

Agregar después de `nombreEl.innerHTML = ...`:

```javascript
// Sidebar avatar: iniciales + color según rol (copiado de bloqueos.html)
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
// No se necesita chequeo de rol adicional: el redirect al inicio de init()
// ya garantiza que todos los roles que llegan aquí son encargado/sistemas/directivo,
// los mismos que ven nav-auditoria, nav-usuarios y nav-servicios (forEach actual).
const lRep = document.getElementById('label-reportes');
if (lRep) lRep.style.display = '';
const lAdm = document.getElementById('label-admin');
if (lAdm) lAdm.style.display = '';
```

> **Corrección respecto al borrador inicial:** el borrador proponía `&& ['sistemas'].includes(usuario.rol)`
> para `label-admin`. Eso es incorrecto. En bloqueos.html (referencia), `label-admin` se muestra
> para todos los roles autorizados sin filtro adicional. Y en dashboard.html el forEach actual ya
> muestra `nav-usuarios` y `nav-servicios` sin ninguna condición de rol extra — ambas labels deben
> seguir exactamente la misma condición que las acciones que encabezan.

---

## 10. Inline styles a eliminar del HTML estático

| Elemento | Style inline actual | Solución |
|---|---|---|
| `<span style="color:#64748b">—</span>` (línea 129) | color hardcoded | `<span class="fecha-sep">—</span>` + `.fecha-sep { color: var(--text-3); }` |
| `style="display:none"` en nav links del navbar viejo | control de visibilidad por JS | MANTENER en el sidebar nuevo — el JS los manipula con `el.style.display` |

### Inline styles en JS que NO se tocan (documentados en §4)

Ver sección §4 — todos los colores en `COLORES_CANAL`, `COLORES_ESTADO`, llamadas a
`svgBarras()`, cuerpos de `svgTorta()`/`svgBarras()`, y template strings de
`renderDashboard()` quedan exactamente como están.

---

## 11. Orden de implementación (pasos con checkpoint)

### Paso 1 — Layout shell, sidebar, design-tokens, CSS completo + `rolBadgeHTML()`

- Agregar `<link rel="stylesheet" href="/assets/design-tokens.css">` en el `<head>`
- Reemplazar `<nav class="navbar">` y todo su CSS por el sidebar de bloqueos.html/presencial.html
- Cambiar `.nav-item.active` al ítem "Dashboard"
- HTML del sidebar: incluir `id="sidebar-avatar"`, `id="nav-nombre"`, `id="label-reportes"` y `id="label-admin"` (con `style="display:none"` por defecto), igual que en bloqueos.html
- Wrap del contenido en `.app-shell > .main-content > .page-inner`
- HTML: bloque `.page-header` con "Panel de gestión" / "Dashboard"
- HTML: `<span style="color:#64748b">—</span>` → `<span class="fecha-sep">—</span>`
- CSS: incluir **todo el CSS del §8** en este paso
- **JS en `init()`:** agregar bloque de `sidebar-avatar` (iniciales + color por rol) copiado de bloqueos.html
- **JS en `init()`:** agregar `lRep.style.display = ''` y `lAdm.style.display = ''` con la lógica de §9
- **JS:** `rolBadgeHTML()` reescrita para usar `.role-badge .role-XXX` (sin estilos inline)
- **Verificado:** 0 hex en `<style>`; 0 hex en HTML estático (excepto `style="display:none"` funcionales); navbar vieja eliminada; todos los IDs del §1 presentes; `sidebar-avatar` + labels en `init()`; `role-badge` sin inline styles

### Paso 2 — Verificación de clases generadas por JS

- Confirmar que `.grid-2`, `.card`, `.card-titulo`, `.tabla-estados`, `.dot`, `.num`, `.stat-grande`, `.stat-numero`, `.stat-label`, `.leyenda`, `.leyenda-item`, `.tabla-op`, `.pos` están definidas en el CSS
- Confirmar que `.area-chip` y `.area-chip.activo` (con espacio, no punto) coinciden con lo que genera `inicializarChipsDash()` — JS usa `chip.classList.toggle('activo')`, CSS define `.area-chip.activo`
- Confirmar que `.alerta.visible` tiene `display: block`
- Confirmar que `.campos-custom.visible` tiene `display: flex`
- Confirmar que `.cargando` y `.vacio` existen
- **Verificado:** todas las clases inyectadas por JS tienen su definición CSS; el inline style del `stat-numero` desde JS sobreescribirá el `color: var(--teal)` del CSS (comportamiento esperado para el indicador de ausentismo)

### Paso 3 — `rolBadgeHTML()` y limpieza final

- Grep final: 0 hex en `<style>`; 0 hex en HTML estático
- Grep final para `.navbar`, `.nav-links`, `.nav-user`, `.btn-logout`, `.badge-rol` → 0 resultados en `<style>`
- Confirmar que los hexadecimales del §4 siguen intactos en el `<script>` (son las exclusiones documentadas)
- Confirmar que `rolBadgeHTML()` usa solo `role-badge ${cls}` sin hex ni `style=`
- Confirmar que `.role-badge`, `.role-encargado`, `.role-operador`, `.role-sistemas`, `.role-directivo` están en design-tokens.css (líneas 324–336) — ya verificado en análisis
- **Verificado:** rediseño completo; 0 hex residuales en `<style>` ni en HTML estático; todas las exclusiones documentadas en §4 presentes e intactas en `<script>`

### Commit por paso
Cada paso hace un commit antes de avanzar al siguiente:
`feat(panel): dashboard paso N — descripción`
