# Handoff: Sistema de Gestión de Turnos — Rediseño UI (Dirección C+)

## Overview

Este paquete documenta el rediseño visual completo del Sistema de Turnos municipal de Villa La Angostura. El sistema **ya existe y es funcional** — la tarea es reemplazar su frontend actual por este nuevo diseño, manteniendo toda la lógica de backend y datos intacta.

El rediseño introduce:
- Paleta oscura profesional (dark mode nativo)
- Tipografía con jerarquía clara (`Outfit` para UI, `DM Mono` para números/códigos)
- Bloqueados con overlay visual contundente
- Cards de turno con badge de servicio y avatar de operador
- Búsqueda global central en topbar
- KPIs con sparklines y números grandes
- Heatmap de actividad anual (22 semanas)
- Vista diferenciada por rol (Encargado vs Operador)
- Panel lateral "Cola de hoy" para Operadores
- Drawer de nueva reserva presencial (sin perder contexto del calendario)

## Fidelidad

**Alta fidelidad (hifi).** Los archivos HTML incluidos son mockups pixel-perfectos con colores, tipografía, espaciado e interacciones finales. El desarrollador debe **recrear esta UI en el stack existente**, no copiar el HTML directamente. Usar los valores exactos de colores, tipografía y espaciado documentados aquí.

---

## Archivos de referencia

| Archivo | Descripción |
|---|---|
| `Sistema de Turnos - Dirección C+.html` | Prototipo principal — 7 pantallas en design canvas |
| `c-plus-shared.jsx` | Componentes y tokens compartidos (fuente de verdad de datos y estilos) |
| `design-canvas.jsx` | Shell del canvas (no relevante para producción) |

> **Abrir `Sistema de Turnos - Dirección C+.html` en cualquier navegador moderno** para ver todas las pantallas interactivas. Usar pan/zoom para inspeccionar cada artboard.

---

## Design Tokens

### Paleta de colores

```
/* Fondos — de más oscuro a más claro */
--bg-0: #060d18   /* fondo base app */
--bg-1: #0b1725   /* sidebar */
--bg-2: #0f1e30   /* área de contenido principal */
--bg-3: #152739   /* cards, paneles, tablas */
--bg-4: #1c3050   /* elementos elevados, toggles */

/* Bordes */
--border:    #1e3450
--border-hi: #284e6a   /* bordes en hover / elementos activos */

/* Acento principal — Teal */
--teal:     #2dd4a0
--teal-dim: rgba(45,212,160,0.09)
--teal-mid: rgba(45,212,160,0.20)

/* Acento secundario — Blue */
--blue:     #4ba8f8
--blue-dim: rgba(75,168,248,0.11)
--blue-mid: rgba(75,168,248,0.22)

/* Advertencia — Amber */
--amber:     #f5a52a
--amber-dim: rgba(245,165,42,0.10)
--amber-mid: rgba(245,165,42,0.22)

/* Error / peligro — Red */
--red:     #f56868
--red-dim: rgba(245,104,104,0.11)
--red-mid: rgba(245,104,104,0.22)

/* Texto */
--text-1: #daeaf8   /* texto principal */
--text-2: #6e90ab   /* texto secundario */
--text-3: #374f62   /* texto deshabilitado / labels */
```

### Tipografía

```
/* Fuentes — importar desde Google Fonts */
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');

--font-ui:   'Outfit', system-ui, sans-serif
--font-mono: 'DM Mono', monospace

/* Escala */
--text-xs:   9px  / 400  — labels, badges, leyendas
--text-sm:   11px / 400  — metadatos, timestamps
--text-base: 12px / 400  — cuerpo de tablas
--text-md:   13px / 500  — ítems de tabla, nombres
--text-lg:   15px / 700  — títulos de topbar
--text-xl:   18px / 800  — títulos de drawer/modal
--text-2xl:  20px / 800  — números de calendario
--text-kpi:  38px / 800  — KPIs del dashboard (DM Mono)
```

### Espaciado y forma

```
--radius-sm:  4px   — badges, chips pequeños
--radius-md:  5-6px — botones, inputs, celdas
--radius-lg:  7px   — cards, paneles, drawers
--radius-xl:  8px   — logo container sidebar

/* Border radius de avatares/círculos: siempre 50% */

/* Gaps típicos */
--gap-xs: 4px
--gap-sm: 6-8px
--gap-md: 10-12px
--gap-lg: 14-16px
--gap-xl: 20-24px
```

---

## Pantallas

### 1. Agenda Semana (vista principal)

**Ruta sugerida:** `/agenda` o `/`

**Layout:** Sidebar fijo (220px) + área principal con topbar de 3 columnas + filtros + grilla de calendario.

#### Topbar (h: 54px)
- **Columna izquierda:** Título "Agenda" + toggle Día/Semana/Mes + flechas de navegación + fecha del rango
- **Columna central:** Buscador global (ancho fijo 340px) con placeholder "Buscar vecino, DNI, n.º turno…" + atajo ⌘K
  - Background: `--bg-3`, border: `--border-hi`, border-radius: 7px
  - El buscador debe abrirse como modal/overlay global al hacer foco (alcance futuro)
- **Columna derecha:** 4 counters (Total / Agendados / Presentes / Ausentes) + botón "+ Nueva Reserva"
  - Counters: número grande (DM Mono, 15px, 800) + label chico (8px, 600), fondo semitransparente del color de acento correspondiente

#### Barra de filtros (h: 36px)
- Label "Área" + chips: "Todas" (activo: teal) / "Licencias de Conducir" / "Tribunal de Faltas"
- Dropdown "Todos los operadores" alineado a la derecha

#### Grilla calendario
- Columna de horas: 46px de ancho, horas en DM Mono 9px, solo las :00
- 7 columnas de días, flex: 1 cada una
- **Header de día:**
  - Nombre del día: 9px / 700 / uppercase / color según estado
  - Número: 20px / 800 / DM Mono / color según estado
  - Badge de estado (solo en bloqueados): "BLOQUEADO" en uppercase, background azul semitransparente, border blue
  - Bajo el badge: nombre del operador bloqueante + motivo del bloqueo (texto 8-8.5px)
  - Si tiene turnos: contador "N turnos" en 8px
- **Estados de día y sus fondos:**

| Estado | Header bg | Celda bg | Color acento |
|---|---|---|---|
| `normal` | transparent | transparent | `--text-2` |
| `today` | `rgba(45,212,160,0.07)` | `rgba(45,212,160,0.03)` | `--teal` |
| `blocked` | `rgba(75,168,248,0.07)` | `rgba(75,168,248,0.03)` | `--blue` |
| `holiday` | `rgba(245,104,104,0.09)` | `rgba(245,104,104,0.04)` | `--red` |
| `closed` | `rgba(0,0,0,0.20)` | `rgba(0,0,0,0.12)` | `--text-3` |

- **Días bloqueados:** superponer patrón de rayas diagonales (`repeating-linear-gradient(-45deg, transparent 10px, rgba(75,168,248,0.055) 20px)`) + marca de agua central "BLOQUEADO" rotada -45deg, `rgba(75,168,248,0.11)`, fontSize 14px, fontWeight 800, letterSpacing 0.28em. Ambos con `pointer-events: none`.
- **Líneas de hora:** color `--border` en :00, `rgba(30,52,80,0.32)` en :30. Cada slot = 44px de alto.

#### Cards de turno
- Posición absoluta: `top: fila * 44px + 2px`, `left/right: 3px`, `height: 40px`
- `border-left: 3px solid <color-acento>`, border-radius: 5px
- Fondo: `--<color>-dim`, borde inset: `box-shadow: inset 0 0 0 1px --<color>-mid`
- Contenido (de arriba a abajo):
  1. Fila: hora (DM Mono 9.5px) + avatar operador (17px circle, iniciales, 2 letras)
  2. Nombre del vecino (11px / 700 / `--text-1`)
  3. Badge de servicio abreviado (ej. "LIC", "TRI") — 8.5px, fondo del color semitransparente
- Colores disponibles para cards: `b` = blue, `g` = teal, `r` = red

#### Zona "agregar turno" (solo en día actual)
- Posición absoluta: `bottom: 8px`, `left/right: 4px`, altura: 30px
- Border dashed `--teal-mid`, color texto `--teal`, ícono "+" + "Agregar turno"

---

### 2. Presencial — Drawer (nueva reserva)

**Ruta sugerida:** Se abre como panel lateral derecho sobre la agenda (`/agenda?modal=presencial` o componente drawer)

**Layout:** El calendario de fondo se atenúa con overlay `rgba(6,13,24,0.78)`. El drawer ocupa 560px desde la derecha, `border-left: 1px solid --border`.

#### Estructura del drawer
1. **Header** (h: ~56px): título "Nueva Reserva" (subtítulo teal uppercase 9px) + "Presencial" (18px/800) + botón cerrar (×, 28px circle)
2. **Steps** (h: ~44px): 3 pasos en línea — Vecino / Turno / Confirmar. El paso completado muestra checkmark en teal. El activo en blue.
3. **Vecino confirmado:** card con avatar inicial + nombre + DNI + email + "✓ Confirmado" en teal. Background `--teal-dim`.
4. **Selector de servicio:** dropdown estilizado con border `--blue`, mostrando nombre + duración + área
5. **Selector de fecha:** fila de 4 chips de día (JUE/VIE/LUN/MAR con fecha). Activo: border `--blue`, fondo `--blue-dim`. Días sin disponibilidad: `opacity: 0.3`
6. **Grilla de horarios:** `grid-template-columns: repeat(4, 1fr)`, gap: 6px. Cada slot: 44x ~38px, DM Mono 13.5px. Estados: disponible (border `--border-hi`) / seleccionado (border `--teal`, fondo `--teal-dim`) / ocupado (opacity 0.3, cursor not-allowed)
7. **Footer:** botón "Cancelar" (border `--border`) + botón "Confirmar Turno →" (background `--teal`, color `--bg-0`, full width relativo)

---

### 3. Dashboard — Analíticas

**Ruta sugerida:** `/dashboard` o `/reportes/analiticas`

#### KPIs (fila de 4 cards)
- Grid 4 columnas, gap: 12px
- Cada card: background `--bg-3`, border `--border`, border-radius 7px, padding 16x18px
- Contenido: label (11px/600/`--text-2`) + número grande (**38px/800/DM Mono**, color de acento) + sparkline SVG (72x34px, último punto destacado) + delta vs semana anterior (11px/600, teal si positivo, red si negativo)
- KPIs: Total semana / Tasa asistencia / Pendientes hoy / Prom. espera

#### Gráfico de barras diario
- SVG responsivo, viewBox calculado según cantidad de barras
- Barras: width 42px, gap 12px, rx 4px
- Color pasivo: `rgba(45,212,160,0.2)` / Color activo (día actual): `--teal`
- Label día debajo, valor encima de la barra

#### Donut de estados
- Radio exterior 50px, strokeWidth 18px, gap entre segmentos
- Fondo: círculo `--border` strokeWidth 18px
- Centro: número total (24px/800/DM Mono/`--text-1`) + "turnos" (10px/`--text-2`)
- Leyenda al lado derecho: dot 8px + label + número

#### Gráfico de línea mensual
- SVG con área rellena (gradiente teal 0%→0 opacity) + línea teal 2px + puntos con circle fill `--bg-3` + stroke teal
- Etiquetas de mes debajo, valores sobre cada punto

#### Heatmap de actividad (22 semanas × 5 días)
- Cada celda: 13x13px, border-radius 2px, gap 2px
- `grid-auto-flow: column` para leer de arriba a abajo por semana
- Escala de color:
  - 0 turnos: `--bg-4`
  - 1-2: `rgba(45,212,160,0.22)`
  - 3-5: `rgba(45,212,160,0.58)`
  - 6+: `--teal`
- Semana actual: `outline: 1.5px solid rgba(45,212,160,0.45)`
- Leyenda con 4 swatches de escala + labels "Menor" / "Mayor"
- Labels de meses sobre las columnas correspondientes (fontSize 9px)

---

### 4. Dashboard — Auditoría

**Ruta sugerida:** `/reportes/auditoria`

#### Resumen de contadores
- Fila de 5 cards (una por tipo de acción): Alta / Edición / Bloqueo / Baja / Sistema
- Cada card: `border-top: 2px solid <color-tipo>`, número en 20px/800/DM Mono

#### Tipos de acción y colores
| Tipo | Color | Label |
|---|---|---|
| `create` | `--teal` (#2dd4a0) | Alta |
| `edit` | `--blue` (#4ba8f8) | Edición |
| `block` | `--amber` (#f5a52a) | Bloqueo |
| `delete` | `--red` (#f56868) | Baja |
| `system` | `--text-2` | Sistema |

#### Tabla de log
- Columnas: indicador (dot 8px) / Acción + detalle / Operador / Fecha / Badge tipo
- Dot: color del tipo de acción
- Acción: 12.5px/500/`--text-1` + detalle en 10.5px/`--text-3`
- Badge: border-radius 20px (pill), fondo `rgba(color, 0.18)`, border `rgba(color, 0.44)`

---

### 5. ABM Usuarios

**Ruta sugerida:** `/admin/usuarios`

#### Tabla
- Columnas: Avatar / Nombre / Email / Rol / Área / Estado (toggle) / Acciones
- Avatar: 32px circle, fondo `rgba(color-rol, 0.13)`, inicial

#### Colores de rol
| Rol | Color |
|---|---|
| Encargado | `--teal` |
| Operador | `--blue` |
| Administrador | `--amber` |

#### Toggle de estado activo/inactivo
- 32x18px, border-radius 9px
- Activo: background `--teal`, knob `--bg-0` en posición derecha
- Inactivo: background `--border`, knob `#5a7a8a` en posición izquierda

#### Botones de acción por fila
- "Editar": border `--border`, color `--text-3`
- "Baja": border `--red-mid`, color `--red`, fondo `--red-dim`

---

### 6. ABM Servicios

**Ruta sugerida:** `/admin/servicios`

- Misma estructura de tabla que Usuarios
- Columnas: Servicio / Área / Duración / Capacidad / Canales / Estado / Acciones
- Badge de área: Licencias → `--blue`, Tribunal → `--teal`

---

### 7. Vista Operador (rol diferenciado)

**Diferencias clave respecto a Encargado:**
- Sidebar simplificado: solo secciones "Calendario" (Agenda + Presencial) — sin Reportes ni Admin
- Avatar en sidebar con color `--blue` (blue) en lugar de teal
- Toggle de vista solo muestra Día/Semana (no Mes)

#### Banner "En Atención" (h: 46px)
- Aparece debajo del topbar cuando hay un turno activo
- Background: `rgba(45,212,160,0.055)`, border-bottom: `rgba(45,212,160,0.2)`
- Dot animado (verde, 7px con box-shadow glow) + "EN ATENCIÓN" uppercase + nombre vecino + servicio + hora ingreso + duración estimada
- Botón "Finalizar turno ✓" alineado a la derecha

#### Vista Día
- Igual que la agenda semanal pero columna única, con cards más anchas (layout horizontal)
- Cards horizontales incluyen: hora / avatar operador / nombre vecino (flex:1) / badge servicio / badge duración
- Línea "ahora" horizontal: 1.5px, color `--teal`, opacity 0.65 + dot izquierdo de 8px

#### Panel "Cola de hoy" (w: 220px, lateral derecho)
- Sección "Atendiendo" (fondo `rgba(45,212,160,0.05)`): nombre + servicio + hora + botones "Ausente" (red) / "Finalizar ✓" (teal)
- Sección "En espera": lista de turnos pendientes
- Footer: botón "Llamar siguiente →"

---

## Sidebar (compartido)

**Ancho:** 220px fijo, `flex-shrink: 0`

#### Header del sidebar
1. Logo VLA: 36x36px, border-radius 8px, "VLA" en teal, fondo `--teal-dim`
2. Texto: "Municipalidad" en 8.5px/700/uppercase/`--text-3` + "Villa La Angostura" en 12.5px/700/`--text-1`
3. Card de usuario activo: padding 7x9px, fondo del color de rol semitransparente, border del mismo color más opaco. Avatar circular 28px + nombre 11.5px/600 + rol 10px/600

#### Mini-calendario (entre header y nav)
- Grilla 7 columnas para días
- Header de días: 8.5px/700/uppercase/`--text-3`
- Días de la semana actual: fondo `--teal-dim`, color `--teal`, fontWeight 700
- Día actual: fondo `--teal` sólido, color `--bg-0`
- Números: DM Mono 10px

#### Navegación
- Grupos con label de sección: 8.5px/700/uppercase/0.1em letterSpacing/`--text-3`
- Ítem activo: `border-left: 2px solid --teal`, fondo `--teal-dim`, color `--teal`, dot 5px a la derecha
- Ítem inactivo: `border-left: 2px solid transparent`, color `--text-2`
- Íconos SVG: 15x15px, stroke 1.5px, strokeLinecap round

#### Grupos de navegación por rol
- **Encargado:** Calendario (Agenda / Presencial / Bloqueos) · Reportes (Auditoría / Dashboard) · Admin. (Usuarios / Servicios)
- **Operador:** Calendario (Agenda / Presencial) — sin más secciones

---

## Comportamientos e Interacciones

### Calendario
- Click en card de turno → modal/drawer de detalle del turno
- Click en zona "Agregar turno" → abre drawer Presencial
- Flechas de navegación de semana → cambia el rango de fechas
- Toggle Día/Semana/Mes → cambia granularidad de la vista

### Presencial (Drawer)
- El drawer se superpone sobre el calendario sin reemplazarlo
- Step 1 (Vecino): búsqueda por nombre/DNI + confirmación
- Step 2 (Turno): selección de servicio + fecha + horario
- Step 3 (Confirmar): resumen + acción final
- Horarios ocupados: `opacity: 0.3`, `cursor: not-allowed`, no seleccionables

### Días bloqueados en calendario
- Las cards existentes siguen siendo visibles sobre el overlay
- No se puede hacer click en la zona vacía para agregar turno
- La zona "Agregar turno" no aparece en días bloqueados/feriados/cerrados

### Toggle de estado (Usuarios/Servicios)
- Click toggling activo/inactivo con confirmación de la acción

### Vista Operador — Banner
- Aparece solo cuando hay un turno con estado "en atención" / "presente"
- "Finalizar turno" → cambia estado del turno a "atendido" y oculta el banner
- "Ausente" → cambia estado a "ausente"
- "Llamar siguiente" en cola → marca el siguiente turno como "en atención"

---

## Animaciones y Transiciones

- Transiciones de hover: `transition: background 0.15s, border-color 0.15s`
- Drawer: `transform: translateX(0) / translateX(100%)`, `transition: transform 0.22s ease`
- Toggle on/off: `transition: left 0.15s`
- Dot "en atención": `animation: pulse 1.8s infinite` (escala 1 → 1.3 → 1)
- El heatmap no tiene animaciones

---

## Assets y Fuentes

- **Google Fonts:** `Outfit` (400, 500, 600, 700, 800) + `DM Mono` (400, 500)
- **Íconos:** SVG inline personalizados (ver función `NavIcon` en `c-plus-shared.jsx`). No se usa ninguna librería de íconos externa.
- **Imágenes:** Ninguna. El diseño no usa imágenes ni ilustraciones.

---

## Notas para el desarrollador

1. **Prioridad de implementación sugerida:**
   - Primero: tokens CSS (paleta, tipografía) como variables globales
   - Segundo: Sidebar + layout shell (con rol)
   - Tercero: Agenda semanal (pantalla de mayor uso)
   - Cuarto: Drawer presencial
   - Quinto: Dashboard analíticas (con heatmap)
   - Sexto: ABM Usuarios y Servicios
   - Último: Vista Operador diferenciada

2. **El calendario usa slots de 44px de alto por media hora.** Cada turno se posiciona con `top: ((hora - 8) * 2 + (minutos >= 30 ? 1 : 0)) * 44px`. Adaptar si el backend devuelve horarios con otra granularidad.

3. **Los colores de card de turno** (blue, teal, red) pueden derivarse del tipo de servicio o del estado del turno — definir esta regla con el equipo de negocio.

4. **El heatmap** requiere un endpoint que devuelva cantidad de turnos por día para las últimas 22 semanas.

5. **El rol del usuario** determina la navegación visible y el color del avatar en el sidebar. Leer del token de sesión.

6. **La búsqueda global** (⌘K) puede implementarse como una librería de command palette (ej. `cmdk` en React, `ninja-keys` para vanilla) con los resultados del backend.
