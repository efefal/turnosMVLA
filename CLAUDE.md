# Sistema de Turnos Municipal — Villa La Angostura
# CLAUDE.md — Contexto del proyecto para Claude Code

---

## ¿Qué es este proyecto?

Bot de Telegram (fase PoC) para reservar turnos en la Municipalidad de Villa La Angostura.
El canal definitivo será WhatsApp Business API cuando pase a producción.
El motor de reservas es Easy!Appointments (self-hosted en Docker).

---

## Stack tecnológico

| Componente | Tecnología |
|---|---|
| Motor de reservas | Easy!Appointments (GPL v3.0, Docker) |
| Base de datos | MySQL 8.0 (contenedor Docker, solo para Easy!Appointments) |
| Bot / Middleware | Node.js |
| Canal PoC | Telegram Bot API |
| Canal producción (futuro) | WhatsApp Business API (Meta) |
| Automatización (futuro) | n8n self-hosted |
| Infraestructura | Docker + Docker Compose |

---

## Archivos principales

- `index.js` — Bot de Telegram. Toda la lógica conversacional, estados de sesión, callbacks de botones.
- `ea.js` — Módulo de integración con la API REST de Easy!Appointments. El bot importa este módulo y nunca habla directamente con la API ni con MySQL.
- `data/usuarios.json` — Persistencia legacy en JSON (en proceso de migración a Easy!Appointments).
- `docker-compose.yml` — Levanta Easy!Appointments + MySQL en contenedores.
- `.env` — Variables de entorno (no subir al repo).

---

## Variables de entorno requeridas (.env)

```
TELEGRAM_TOKEN=token_de_telegram
EA_BASE_URL=http://localhost
EA_TOKEN=mvla-turnos-2026-api-token
```

---

## Configuración actual de Easy!Appointments

- URL local: http://localhost
- API Token: mvla-turnos-2026-api-token
- Servicios:
  - Nueva Licencia (ID: 2, duración: 30 min)
  - Pago Multas (ID: 3, duración: 15 min)
- Operadores:
  - IDs 4, 5, 6 → Licencias de Conducir
  - IDs 7, 8 → Tribunal de Faltas

---

## Funciones disponibles en ea.js

Estas son las únicas funciones que el bot debe usar para interactuar con Easy!Appointments:

```javascript
obtenerServicios()                              // Array de servicios: { id, name, duration }
obtenerProveedores()                            // Array de operadores: { id, firstName, lastName, services[] }
obtenerDisponibilidad(serviceId, providerId, fecha)   // Array de strings: ["08:30", "09:00", ...]
obtenerDisponibilidadServicio(serviceId, fecha)        // { horariosLibres[], mapaHorarioOperador{} }
crearCita(datos)                                // Crea cita en EA, devuelve objeto con ID asignado
cancelarCita(appointmentId)                     // Elimina cita por ID numérico
obtenerCitasDelCliente(email)                   // Citas activas buscando por email ficticio
```

Email ficticio del vecino: `dni_NUMERODNI@municipio.local`

---

## Reglas de desarrollo — CRÍTICAS

1. **Nunca conectar directamente a MySQL.** Toda interacción con Easy!Appointments pasa exclusivamente por las funciones de `ea.js`.

2. **Cal.com está descartado definitivamente.** Requiere licencia Enterprise de pago para su API REST. No se menciona ni se evalúa como alternativa.

3. **El vecino nunca elige operador.** La asignación es automática: `obtenerDisponibilidadServicio()` devuelve `mapaHorarioOperador{}` que el bot usa internamente para saber a qué operador asignar cada horario.

4. **Preservar índices originales de TRAMITES.** Los callbacks de Telegram usan `tramite_N` donde N es el índice en el array `TRAMITES[]`. Nunca renumerar ni alterar esa correspondencia.

5. **Comentar el "por qué" de cada bloque, no solo el "qué".** El código tiene comentarios explicativos extensos; mantener ese estilo en cualquier código nuevo.

6. **Un solo archivo de módulo de integración.** No crear módulos adicionales de conexión a la API. Todo va en `ea.js`.

---

## Estados de conversación del bot (index.js)

```
INICIAL               → Sin flujo activo
ESPERANDO_DNI         → Pedimos DNI, aguardamos respuesta
ESPERANDO_NOMBRE      → DNI nuevo, pedimos nombre y apellido
MENU_GESTION          → DNI existente, mostramos menú con botones
ESPERANDO_TRAMITE     → Elegir trámite (Inline Keyboard)
ESPERANDO_FECHA       → Elegir fecha (Inline Keyboard, 3 días hábiles)
ESPERANDO_HORARIO     → Elegir horario (Inline Keyboard, slots de EA)
ESPERANDO_CANCELACION → Elegir qué turno borrar
ESPERANDO_MODIFICACION→ Elegir qué turno modificar
```

---

## Lógica de memoria en sesión (registrosEnProceso)

```javascript
// Objeto en memoria. Clave: chatId. Valor: datos parciales del flujo activo.
registrosEnProceso[chatId] = {
  dni,
  nombre,
  tramite,           // nombre del trámite (string), no el índice
  fecha,             // "YYYY-MM-DD"
  serviceId,         // ID numérico del servicio en Easy!Appointments
  mapaHorarioOperador, // { "08:00": 4, "09:00": 5, ... }
  esModificacion,    // true si el flujo viene de "editar_N"
}
```

---

## Timeout de sesión

- Duración: 10 minutos (600.000 ms) de inactividad
- Función: `gestionarTimeout(chatId)` en `index.js`
- Se llama al inicio de CADA mensaje y CADA callback
- No se crea timeout si el estado es INICIAL
- Al expirar: limpia `registrosEnProceso[chatId]`, vuelve a estado INICIAL, envía aviso

---

## Estado actual de la migración a Easy!Appointments

### ✅ Ya migrado
- Carga dinámica de trámites al iniciar (`cargarTramites()` usa `obtenerServicios()`)
- Consulta de disponibilidad por fecha y servicio (CALLBACK B usa `obtenerDisponibilidadServicio()`)

### 🔄 Pendiente de migrar (todavía usa data/usuarios.json)
- **RAMA B**: Lectura de turnos activos del vecino al ingresar su DNI
- **CALLBACK C**: Creación del nuevo turno (debe usar `crearCita()`)
- **CALLBACK H**: Cancelación de turno (debe usar `cancelarCita()`)
- **CALLBACK F2**: Modificación de turno (debe combinar `cancelarCita()` + `crearCita()`)

### Lógica de identificación del vecino en Easy!Appointments
Como EA no tiene campo DNI nativo, se usa email ficticio: `dni_NUMERODNI@municipio.local`
Esto permite buscar los turnos de un vecino con `obtenerCitasDelCliente(email)`.

---

## Próximos pasos (actualizar al avanzar)

- [x] **BUG RESUELTO — Timeout se dispara después de confirmar un turno:** Se agregó llamada
      a `gestionarTimeout(chatId)` en CALLBACK C luego de setear el estado a INICIAL.
      Esto cancela el timeout que se había creado al inicio del callback y no genera uno nuevo.
- [x] Migrar CALLBACK C: reemplazar `guardarUsuarios()` por `crearCita()`
- [x] Migrar RAMA B: reemplazar `buscarUsuarioPorDni()` por `obtenerCitasDelCliente()`
- [x] Migrar CALLBACK H: reemplazar `splice + guardarUsuarios()` por `cancelarCita()`
- [ ] Migrar CALLBACK F2: liberar cupo con `cancelarCita()` antes de pedir nueva fecha
- [ ] Integrar API de feriados nacionales (api.argentinadatos.com)
- [ ] Configurar WhatsApp Business API para producción

---

## Estructura de carpetas

```
turnosMVLA/
├── index.js          ← Bot principal
├── ea.js             ← Módulo integración Easy!Appointments
├── .env              ← Variables de entorno (no en repo)
├── CLAUDE.md         ← Este archivo
├── package.json
└── data/
    └── usuarios.json ← Base de datos legacy (migración en curso)
```

Easy!Appointments corre por separado en:
```
EasyAppointments/
├── docker-compose.yml
└── backup_easyappointments.sql
```

Repositorio: https://github.com/efefal/turnosMVLA

---

## Flujo de trabajo en cada sesión

1. Leer este archivo antes de empezar cualquier tarea.
2. Trabajar de a UNA tarea por vez — no avanzar a la siguiente sin terminar la actual.
3. Después de completar cada tarea y verificar que funciona, hacer un commit
   de Git con un mensaje descriptivo y luego ejecutar `git push` para subir
   los cambios a GitHub antes de continuar.
4. Si hay que interrumpir una tarea a mitad, revertir los cambios parciales antes de parar.
5. Al terminar la sesión, actualizar la sección "Próximos pasos" marcando lo completado
   y ajustando el siguiente paso si corresponde.

---

## Perfil del desarrollador

Trabajo en IT (soporte/helpdesk). No soy desarrollador de formación.
Estoy aprendiendo Node.js mientras construyo este proyecto.
**Explicar el "por qué" de la sintaxis y la lógica en los comentarios del código.**
No asumir conocimiento de patrones de diseño de software.
