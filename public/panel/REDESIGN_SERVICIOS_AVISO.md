# Plan — Aviso condicional al desactivar un servicio con turnos futuros
# Mismo criterio que ya tiene areas.html — no bloquea, solo avisa.
# Restricciones: Vanilla JS · sin frameworks · sin tocar el resto del ABM

---

## Contexto

`servicios-admin.html` hoy desactiva un servicio sin avisar nada, aunque
tenga turnos futuros agendados — el vecino sigue con su turno (no se
cancela), pero el trámite deja de estar disponible para reservas nuevas
sin que quien desactiva se entere de que hay gente esperando ese trámite.

`areas.html` ya resuelve el mismo problema para áreas (servicios activos +
usuarios asignados) con un `confirm()` condicional: solo pregunta si hay
algo en riesgo, y si no hay nada, desactiva directo. Este plan replica ese
patrón para servicios, con "turnos futuros agendados" como el dato en
riesgo.

**Definición de "turno en riesgo"** (confirmada, coincide exactamente con
el chequeo anti-duplicado ya usado en `routes/publico.js:280-287` y
`routes/panel.js:1062-1069`):

```sql
estado = 'agendado'
AND (fecha > CURDATE() OR (fecha = CURDATE() AND hora_inicio > CURTIME()))
```

No se usa la versión simplificada (`fecha >= hoy`) porque contaría como
"activo" un turno de hoy cuya hora ya pasó — inconsistente con los otros
dos lugares del sistema que hacen este mismo chequeo.

**Confirmado:** `PATCH /panel/servicios/:id` (routes/panel.js:2237) solo
toca la tabla `servicios` (`UPDATE servicios SET activo = ? ...`) — nunca
toca `turnos`. Desactivar un servicio no cancela ni modifica los turnos
existentes, solo bloquea reservas nuevas. El mensaje de confirmación debe
reflejar esto con precisión (a diferencia de áreas, acá no hay nada que
"desactivar manualmente" del lado del turno).

---

## 1. Cambio en backend

`GET /panel/servicios/admin` ([routes/panel.js:2146-2185](../../routes/panel.js#L2146)) — agregar una columna calculada a las dos variantes de la query (rama `esSistemas` y rama `else`), mismo patrón de subquery que ya usa `GET /panel/areas/admin`:

```sql
SELECT s.id, s.nombre, s.duracion_min, s.max_dias_anticipacion,
       s.mensaje_confirmacion, s.activo, s.created_at,
       a.id AS area_id, a.nombre AS area_nombre,
       (SELECT COUNT(*) FROM turnos t
        WHERE t.servicio_id = s.id
          AND t.estado = 'agendado'
          AND (t.fecha > CURDATE() OR (t.fecha = CURDATE() AND t.hora_inicio > CURTIME()))
       ) AS turnos_activos
FROM servicios s
JOIN areas a ON s.area_id = a.id
...
```

Se agrega en ambas ramas (sistemas y no-sistemas), sin tocar el resto de la query ni el `WHERE`/`ORDER BY` existente.

---

## 2. Cambio en frontend

### `renderServicios()` — pasar `turnos_activos` al botón

El `onclick` de "Desactivar/Activar" (línea ~490 según el código actual) pasa hoy `toggleActivo(${s.id}, ${s.activo ? 0 : 1})`. Se agrega `s.turnos_activos` y el nombre (igual que áreas, para poder armar el mensaje):

```js
onclick="toggleActivo(${s.id}, ${s.activo ? 0 : 1}, ${s.turnos_activos}, \`${esc(s.nombre).replace(/`/g, '\\`')}\`)"
```

### `toggleActivo(id, nuevoActivo, turnosActivos, nombre)` — confirm() condicional

```js
async function toggleActivo(id, nuevoActivo, turnosActivos, nombre) {
  if (nuevoActivo === 0 && turnosActivos > 0) {
    const plural = turnosActivos !== 1;
    const confirmar = confirm(
      `¿Desactivar "${nombre}"? Tiene ${turnosActivos} turno${plural ? 's' : ''} ` +
      `agendado${plural ? 's' : ''} a futuro — no se van a cancelar, pero el trámite ` +
      `dejará de estar disponible para nuevas reservas hasta que lo reactives.`
    );
    if (!confirmar) return;
  }

  const res = await apiFetch(`/panel/servicios/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ activo: nuevoActivo === 1 }),
  });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) {
    mostrarAlerta('error-lista', 'ok-lista', 'error', data.error || 'No se pudo cambiar el estado.');
    return;
  }
  mostrarAlerta('error-lista', 'ok-lista', 'ok',
    nuevoActivo ? 'Servicio activado.' : 'Servicio desactivado.');
  cargarServicios();
}
```

Nada más de la función cambia — el resto del PATCH, manejo de error y refresco de la tabla quedan igual que hoy.

### Texto del mensaje (tono — comparación directa con áreas)

| | Áreas (ya existente) | Servicios (nuevo) |
|---|---|---|
| Mensaje | `¿Desactivar "${nombre}"? Tiene ${detalle} — desactivalos manualmente si querés ocultar los servicios del bot y la web.` | `¿Desactivar "${nombre}"? Tiene ${n} turno${s} agendado${s} a futuro — no se van a cancelar, pero el trámite dejará de estar disponible para nuevas reservas hasta que lo reactives.` |

Mismo formato: pregunta directa con el nombre entre comillas, el dato concreto en riesgo, y una frase de cierre que aclara qué pasa en la práctica — sin alarmismo, sin bloquear la acción.

---

## 3. Casos a verificar

| Caso | Dato de prueba | Resultado esperado |
|---|---|---|
| **0 turnos futuros activos** | Servicio sin turnos, o con turnos todos pasados/cancelados/atendidos | Desactiva directo, sin `confirm()`. Mensaje de éxito "Servicio desactivado." como hoy. |
| **1 turno futuro activo** | Servicio con exactamente 1 turno `agendado` en el futuro | `confirm()` dispara con singular correcto: *"Tiene 1 turno agendado a futuro"* (sin "s"). Cancelar el `confirm()` no cambia nada; confirmar desactiva igual que el caso sin turnos. |
| **2+ turnos futuros activos** | Servicio con 2 o más turnos `agendado` en el futuro | `confirm()` dispara con plural correcto: *"Tiene N turnos agendados a futuro"*. Mismo comportamiento de confirmar/cancelar que el caso anterior. |

Adicional a verificar (no un caso nuevo, sino asegurar que no se rompió nada):
- Reactivar un servicio (`nuevoActivo === 1`) nunca dispara `confirm()`, sin importar `turnos_activos` — la condición es explícitamente `nuevoActivo === 0`.
- Un turno `agendado` de **hoy** con hora ya pasada no debe contar (verifica que la condición `hora_inicio > CURTIME()` se está aplicando, no la versión simplificada).
- Un turno `cancelado` o `atendido` en el futuro no debe contar (verifica el filtro `estado = 'agendado'`).
- La tabla de servicios (`renderServicios()`) sigue mostrando todo lo demás sin cambios — la columna nueva (`turnos_activos`) no se agrega a ninguna celda visible de la tabla, solo se usa internamente para el `confirm()`.

---

## Commit propuesto (al cerrar, tras verificación)

```
feat(panel): aviso condicional al desactivar servicio con turnos futuros

Mismo patrón ya usado en areas.html: GET /panel/servicios/admin ahora
incluye turnos_activos (agendados a futuro, misma definición que el
chequeo anti-duplicado de publico.js/panel.js). toggleActivo() en
servicios-admin.html muestra un confirm() con el conteo solo al
desactivar un servicio con turnos en riesgo — desactiva directo si no
hay ninguno.
```
