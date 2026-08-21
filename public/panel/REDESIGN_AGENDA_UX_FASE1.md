# Plan — Mejoras UX en agenda.html y modales del panel (Fase 1)
# Bajo riesgo: cambios de layout/contenido en cards existentes + cierre de
# modales por Escape/backdrop-click. Sin cambios de lógica de negocio,
# sin cambios de backend.
# Restricciones: Vanilla JS · sin frameworks · reusar funciones de cierre
# existentes (con su limpieza de estado propia), no inventar una genérica.

---

## 1. Vista día — card sin hora, 2 filas (Alternativa 3 confirmada)

`renderizarTablaDia()`, agenda.html:1304-1491.

### HTML actual de la card (a reemplazar)

```html
<div class="turno-card ${cardColor}" style="top:${top}px; height:auto; min-height:40px; ${posStyle}"
     data-id="${t.id}" onclick="abrirDetalleTurno(${t.id})">
  <div class="turno-card-inner">
    <div class="turno-row-1">
      <span class="turno-hora font-mono">${esc(t.hora_inicio.substring(0, 5))}</span>
      ${avatarHTML}
      <span class="turno-nombre" style="flex:1">${esc(t.vecino_nombre)}</span>
      <span class="svc-badge ${badgeCls}">${badgeLabel}</span>
    </div>
    ${accionesHTML ? `<div class="turno-acciones"${compacto ? ' style="margin-top:1px"' : ''}>${accionesHTML}</div>` : ''}
  </div>
</div>
```

### HTML nuevo

```html
<div class="turno-card ${cardColor}" style="top:${top}px; height:auto; min-height:40px; ${posStyle}"
     data-id="${t.id}" onclick="abrirDetalleTurno(${t.id})">
  <div class="turno-card-inner">
    <div class="turno-row-1">
      ${avatarHTML}
      <span class="turno-nombre" style="flex:1">${esc(t.vecino_nombre)}</span>
    </div>
    <div class="turno-tramite">${esc(t.servicio_nombre || '')}</div>
    ${accionesHTML ? `<div class="turno-acciones"${compacto ? ' style="margin-top:1px"' : ''}>${accionesHTML}</div>` : ''}
  </div>
</div>
```

Cambios: se saca `<span class="turno-hora">` y `<span class="svc-badge">`; se agrega `<div class="turno-tramite">` como fila propia, debajo de `turno-row-1`.

### Limpieza de variables ya no usadas en esta función

`badgeCls`/`badgeLabel` (líneas 1398-1411) dejan de usarse en `renderizarTablaDia()` — se simplifica el bloque de color a solo `cardColor` (no toca `renderizarSemana()`, que tiene su propia copia de este bloque y sigue necesitando `badgeCls`/`badgeLabel` para su rama no-compacta):

```js
// ANTES (líneas 1398-1411):
let cardColor, badgeCls, badgeLabel;
if      (svcId == 2) { cardColor = 'turno-blue'; badgeCls = 'svc-blue'; badgeLabel = 'LIC'; }
else if (svcId == 3) { cardColor = 'turno-teal'; badgeCls = 'svc-teal'; badgeLabel = 'TRI'; }
else if (svcId) {
  cardColor  = 'turno-red';
  badgeCls   = 'svc-red';
  badgeLabel = (t.servicio_nombre || '???').substring(0, 3).toUpperCase();
} else {
  if      (t.estado === 'agendado') { cardColor = 'turno-blue'; badgeCls = 'svc-blue'; }
  else if (t.estado === 'presente') { cardColor = 'turno-teal'; badgeCls = 'svc-teal'; }
  else                              { cardColor = 'turno-red';  badgeCls = 'svc-red';  }
  badgeLabel = (t.servicio_nombre || '???').substring(0, 3).toUpperCase();
}

// DESPUÉS:
let cardColor;
if      (svcId == 2) { cardColor = 'turno-blue'; }
else if (svcId == 3) { cardColor = 'turno-teal'; }
else if (svcId) {
  cardColor = 'turno-red';
} else {
  if      (t.estado === 'agendado') cardColor = 'turno-blue';
  else if (t.estado === 'presente') cardColor = 'turno-teal';
  else                              cardColor = 'turno-red';
}
```

### CSS nueva — `.turno-tramite`

Se agrega junto a las reglas existentes de `.turno-hora`/`.turno-nombre` (agenda.html, alrededor de la línea 433):

```css
.turno-tramite {
  font-size: var(--text-xs);
  color: var(--text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-top: 1px;
}
```

### Qué pasa con el ancho/wrap si el trámite es largo

`overflow:hidden; text-overflow:ellipsis; white-space:nowrap` — **mismo criterio que `.turno-nombre`**, no un criterio nuevo. Un trámite largo como "Renovación de Licencia" trunca con `…` si no entra en el ancho de la columna; uno corto como "Pago de Multas" se muestra completo. La card **no crece en altura** por el largo del texto de trámite — la fila es de una sola línea fija, igual que el nombre del vecino arriba. Esto mantiene la altura de la card predecible (importante porque ya hay superposición de cards en la misma franja horaria, resuelta por `agruparPorFila`/`calcularPosicionHorizontal`, que asume alturas consistentes).

---

## 2. Vista semana — prioridad invertida en modo compacto

`renderizarSemana()`, agenda.html:1748+, rama `compacto` (línea 1884-1906).

### Antes

```js
const contenidoHTML = compacto
  ? `<div class="turno-row-1">
       <span class="turno-hora font-mono">${esc(tc.hora_inicio.substring(0, 5))}</span>
       <span style="display:inline-block;width:4px;height:4px;border-radius:50%;background:${dotColorVar};flex-shrink:0;"></span>
     </div>`
  : `<div class="turno-row-1">
       <span class="turno-hora font-mono">${esc(tc.hora_inicio.substring(0, 5))}</span>
       ${avatarHTML}
     </div>
     <div class="turno-nombre">${esc(tc.vecino_nombre)}</div>
     <span class="svc-badge ${badgeCls}">${badgeLabel}</span>`;
```

### Después

```js
const contenidoHTML = compacto
  ? `<div class="turno-row-1">${avatarHTML}</div>`
  : `<div class="turno-row-1">
       <span class="turno-hora font-mono">${esc(tc.hora_inicio.substring(0, 5))}</span>
       ${avatarHTML}
     </div>
     <div class="turno-nombre">${esc(tc.vecino_nombre)}</div>
     <span class="svc-badge ${badgeCls}">${badgeLabel}</span>`;
```

Solo cambia la rama `compacto`. La rama no-compacta (`n < 3`) queda intacta — sigue mostrando hora + avatar + nombre + badge, sin cambios.

`dotColorVar` (línea 1885) deja de usarse — se elimina esa línea junto con el cambio (ya no hay punto de color que pintar).

---

## 3. Escape + backdrop-click en los 6 modales

Backdrop-click ya existe en 5 de 6 modales (patrón idéntico: `if (e.target === document.getElementById('...-fondo')) cerrar...()`, registrado dentro de `init()` en cada archivo). Falta solo en `modal-detalle-fondo` (agenda.html). Escape no existe en ningún modal hoy.

**Criterio:** un `keydown` por archivo (no una función genérica cross-archivo — no hay sistema de módulos, y cada `cerrarModal()` limpia estado propio distinto que hay que preservar). Cada listener llama a la función de cierre real ya existente, nunca reimplementa el cierre a mano.

### `agenda.html` — 2 modales (`modal-fondo`, `modal-detalle-fondo`)

Agregar el backdrop-click que falta + el listener de Escape, junto al backdrop-click ya existente (línea 2364-2366):

```js
document.getElementById('modal-fondo').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-fondo')) cerrarModal();
});
// NUEVO — backdrop-click que faltaba en el modal de detalle
document.getElementById('modal-detalle-fondo').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-detalle-fondo')) cerrarDetalleTurno();
});

// NUEVO — Escape cierra el modal que esté abierto (a lo sumo uno a la vez)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('modal-fondo').classList.contains('abierto')) cerrarModal();
  else if (document.getElementById('modal-detalle-fondo').classList.contains('abierto')) cerrarDetalleTurno();
});
```

### `usuarios.html` — 2 modales (`modal-fondo`, `modal-reset-fondo`)

Junto al backdrop-click existente (línea 1232-1237):

```js
// NUEVO — Escape cierra el modal que esté abierto
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('modal-fondo').classList.contains('abierto')) cerrarModal();
  else if (document.getElementById('modal-reset-fondo').classList.contains('abierto')) cerrarModalReset();
});
```

### `servicios-admin.html` — 1 modal (`modal-fondo`)

Junto al backdrop-click existente (línea 728-730):

```js
// NUEVO
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('modal-fondo').classList.contains('abierto')) {
    cerrarModal();
  }
});
```

### `areas.html` — 1 modal (`modal-fondo`)

Junto al backdrop-click existente (línea 561-563), mismo snippet que `servicios-admin.html`.

### `bloqueos.html` — sin modales, sin cambios.

---

## 4. Casos a verificar antes de comitear

### Vista día
- [ ] Card ya no muestra hora — confirmar visualmente que no queda ningún resto de `.turno-hora`.
- [ ] Nombre del vecino visible completo (o truncado con `…` si es muy largo, mismo criterio que antes).
- [ ] Trámite legible en la segunda fila — probar con un trámite de nombre corto (Pago de Multas) y uno largo (Renovación de Licencia) para confirmar el truncado por ellipsis, no wrap ni desborde.
- [ ] Botones de acción (Tomar/Cancelar, Presente/Ausente/Liberar) siguen apareciendo y funcionando igual — el cambio no tocó `accionesHTML` ni sus `onclick`.
- [ ] Click en la card (fuera de los botones) sigue abriendo el modal de detalle.

### Vista semana
- [ ] Caso compacto (n≥3 turnos superpuestos en la misma franja) → se ve el avatar/iniciales del operador (o el badge "?" si no está tomado), no hora + punto.
- [ ] Caso no-compacto (n<3) → sin cambios, sigue mostrando hora + avatar + nombre + badge completo.
- [ ] Ningún error de consola por `dotColorVar` u otra variable que haya quedado referenciada sin definir tras la limpieza.

### Los 6 modales
- [ ] **Escape** cierra el modal que esté abierto, en cada uno de los 5 archivos con modales.
- [ ] Tras cerrar con Escape, el estado propio queda limpio — confirmar explícitamente por archivo:
  - `agenda.html`: `turnoACancelar === null` (modal cancelar); sin estado propio que limpiar en el de detalle.
  - `usuarios.html`: `idEditando === null && horariosEditar.length === 0` (modal editar); `idResetando === null` (modal reset).
  - `servicios-admin.html` / `areas.html`: `idEditando === null`.
- [ ] **Backdrop-click** (click en el fondo oscurecido, fuera de la caja) hace exactamente lo mismo que Escape — mismo estado limpio.
- [ ] Backdrop-click nuevo en `modal-detalle-fondo` (agenda.html) — el único que faltaba — probado explícitamente.
- [ ] **Escape sin ningún modal abierto** → no tira error en consola (los checks son `classList.contains('abierto')`, que devuelven `false` sin lanzar excepción si el modal no está abierto — confirmar en la práctica, no solo por lectura de código).
- [ ] **Escape en el buscador global** (agenda.html) sigue cerrando el dropdown de resultados como hoy, sin interferencia del nuevo listener de modales — probar con el dropdown de búsqueda abierto y ningún modal abierto (debe cerrar solo el buscador) y con ambos escenarios por separado para confirmar que no hay doble efecto no deseado.

---

## Commit propuesto (al cerrar, tras verificación)

```
feat(panel): mejoras UX en agenda — cards sin hora redundante,
prioridad invertida en semana compacta, y cierre de modales con
Escape/backdrop-click

Fase 1 de un trabajo en 2 fases. Vista día: la card ya no repite la
hora (redundante con la posición en la grilla), gana una segunda fila
con el nombre completo del trámite en vez del badge abreviado. Vista
semana (modo compacto, n>=3 turnos superpuestos): se prioriza mostrar
avatar/iniciales del operador sobre la hora, mismo criterio de
redundancia con la grilla. Los 6 modales del panel (agenda x2,
usuarios x2, servicios-admin, areas) ahora cierran con Escape además
del botón explícito; se agrega también el backdrop-click que faltaba
en el modal de detalle de turno — los otros 5 ya lo tenían. Cada
cierre reusa la función de cierre existente de cada modal (con su
limpieza de estado propia), sin una función genérica cross-archivo.
```
