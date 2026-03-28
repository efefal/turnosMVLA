// =============================================================
// ea.js — Módulo de integración con la API de Easy!Appointments
// Centraliza todas las llamadas HTTP al motor de reservas.
// El bot (index.js) importa las funciones de este archivo
// y nunca habla directamente con la API.
// =============================================================

const https = require('https');
const http  = require('http');

// ---------------------------------------------------------------
// CONFIGURACIÓN
// ---------------------------------------------------------------
// La URL base de Easy!Appointments y el token de API se leen
// desde variables de entorno para no hardcodear credenciales.
const EA_BASE_URL = process.env.EA_BASE_URL || 'http://localhost';
const EA_TOKEN    = process.env.EA_TOKEN     || '';

// ---------------------------------------------------------------
// FUNCIÓN AUXILIAR: llamada HTTP a la API
// ---------------------------------------------------------------
// Todas las funciones públicas de este módulo usan llamadaAPI()
// internamente. Esto centraliza el manejo de headers, errores
// de red y parsing de JSON en un solo lugar.
//
// Parámetros:
//   método   → 'GET', 'POST', 'DELETE', etc.
//   ruta     → por ejemplo '/index.php/api/v1/services'
//   cuerpo   → objeto JavaScript a enviar como JSON (opcional)
//
// Devuelve una Promise que resuelve con el objeto/array
// parseado de la respuesta JSON.
function llamadaAPI(método, ruta, cuerpo) {
  return new Promise((resolve, reject) => {
    const urlCompleta = `${EA_BASE_URL}${ruta}`;
    const urlObj      = new URL(urlCompleta);

    // Elegimos http o https según el protocolo de la URL base.
    const cliente = urlObj.protocol === 'https:' ? https : http;

    // Convertimos el cuerpo a JSON solo si fue proporcionado.
    const bodyStr = cuerpo ? JSON.stringify(cuerpo) : '';

    const opciones = {
      hostname: urlObj.hostname,
      port:     urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path:     urlObj.pathname + urlObj.search,
      method:   método,
      headers: {
        'Authorization': `Bearer ${EA_TOKEN}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        // Content-Length es obligatorio en POST/PUT para que el
        // servidor sepa cuántos bytes leer del cuerpo.
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = cliente.request(opciones, (res) => {
      let data = '';
      // Los datos llegan en fragmentos; los acumulamos en 'data'.
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          // Si la respuesta está vacía (ej: DELETE exitoso), resolvemos
          // con null en lugar de intentar parsear un string vacío.
          resolve(data ? JSON.parse(data) : null);
        } catch (e) {
          reject(new Error(`Error al parsear respuesta JSON: ${data}`));
        }
      });
    });

    req.on('error', reject);

    // Si hay cuerpo, lo escribimos en el stream de la request.
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------
// FUNCIÓN 1: obtenerServicios()
// ---------------------------------------------------------------
// Devuelve el array de servicios (trámites) configurados en
// Easy!Appointments. Cada elemento tiene: id, name, duration.
// El bot usa esta función al iniciar para cargar los trámites
// disponibles dinámicamente en lugar de tenerlos hardcodeados.
async function obtenerServicios() {
  return llamadaAPI('GET', '/index.php/api/v1/services');
}

// ---------------------------------------------------------------
// FUNCIÓN 2: obtenerProveedores()
// ---------------------------------------------------------------
// Devuelve el array completo de proveedores (operadores).
// Cada elemento incluye: id, firstName, lastName, services[].
// El bot usa esta función para saber qué operadores atienden
// cada servicio y consultar su disponibilidad individual.
async function obtenerProveedores() {
  return llamadaAPI('GET', '/index.php/api/v1/providers');
}

// ---------------------------------------------------------------
// FUNCIÓN 3: obtenerDisponibilidad(serviceId, providerId, fecha)
// ---------------------------------------------------------------
// Devuelve un array de strings con los horarios libres para
// un proveedor y servicio específicos en una fecha dada.
// Ejemplo de respuesta: ["08:30", "09:00", "09:30", ...]
//
// Parámetros:
//   serviceId  → ID numérico del servicio (trámite)
//   providerId → ID numérico del proveedor (operador)
//   fecha      → string en formato "YYYY-MM-DD"
async function obtenerDisponibilidad(serviceId, providerId, fecha) {
  const ruta = `/index.php/api/v1/availabilities?serviceId=${serviceId}&providerId=${providerId}&date=${fecha}`;
  return llamadaAPI('GET', ruta);
}

// ---------------------------------------------------------------
// FUNCIÓN 4: obtenerDisponibilidadServicio(serviceId, fecha)
// ---------------------------------------------------------------
// Versión de alto nivel: consulta la disponibilidad de TODOS
// los operadores de un servicio y devuelve un objeto con:
//   {
//     horariosLibres: ["08:00", "09:00", ...],  // slots únicos disponibles
//     mapaHorarioOperador: { "08:00": 4, "09:00": 5, ... } // a quién asignar
//   }
//
// El bot usa esto para mostrarle horarios al vecino sin exponer
// qué operador lo va a atender. Al confirmar el horario, el bot
// ya sabe a qué operador asignar la reserva gracias al mapa.
//
// Si un horario está disponible en múltiples operadores, se
// asigna al primero encontrado (distribución FIFO simple).
async function obtenerDisponibilidadServicio(serviceId, fecha) {
  // Primero obtenemos todos los proveedores del sistema.
  const todosLosProveedores = await obtenerProveedores();

  // Filtramos solo los que atienden este servicio.
  // El campo 'services' es un array de IDs numéricos.
  const proveedoresDelServicio = todosLosProveedores.filter(
    (p) => p.services.includes(serviceId)
  );

  // Para cada proveedor consultamos su disponibilidad en paralelo.
  // Promise.all() lanza todas las consultas a la vez y espera
  // a que todas terminen, en lugar de hacerlas una por una.
  const resultados = await Promise.all(
    proveedoresDelServicio.map(async (proveedor) => {
      const slots = await obtenerDisponibilidad(serviceId, proveedor.id, fecha);
      // slots puede ser null si la API falla para ese proveedor.
      return { providerId: proveedor.id, slots: slots || [] };
    })
  );

  // Construimos el mapa horario → operador.
  // Si el horario ya está en el mapa, no lo pisamos (primer operador gana).
  const mapaHorarioOperador = {};
  for (const resultado of resultados) {
    for (const slot of resultado.slots) {
      if (!mapaHorarioOperador[slot]) {
        mapaHorarioOperador[slot] = resultado.providerId;
      }
    }
  }

  // Los horarios libres son las claves del mapa, ordenadas.
  const horariosLibres = Object.keys(mapaHorarioOperador).sort((a, b) => {
    return a.localeCompare(b);
  });

  return { horariosLibres, mapaHorarioOperador };
}

// ---------------------------------------------------------------
// FUNCIÓN 5: crearCita(datos)
// ---------------------------------------------------------------
// Crea una nueva cita en Easy!Appointments.
//
// Parámetros (objeto 'datos'):
//   serviceId  → ID del servicio
//   providerId → ID del operador asignado
//   nombre     → nombre del vecino
//   apellido   → apellido (puede ser string vacío)
//   email      → email (usamos uno ficticio con el DNI si no hay)
//   telefono   → teléfono (opcional)
//   fechaHora  → string ISO 8601: "2026-03-30 09:00:00"
//   notas      → string con DNI u otra info adicional
//
// Devuelve el objeto de la cita creada con su ID asignado por EA.
async function crearCita(datos) {
  const cuerpo = {
    start:    datos.fechaHora,
    // Easy!Appointments calcula el end sumando la duración del servicio.
    // Igualmente lo incluimos para cumplir con el schema de la API.
    end:      datos.fechaHoraFin,
    location: '',
    notes:    datos.notas || '',
    customerId: null, // EA puede crear el customer inline con el objeto abajo
    providerId: datos.providerId,
    serviceId:  datos.serviceId,
    customer: {
      firstName: datos.nombre,
      lastName:  datos.apellido || '',
      email:     datos.email || `dni_${datos.dni}@municipio.local`,
      phone:     datos.telefono || '',
      notes:     `DNI: ${datos.dni}`,
    },
  };

  return llamadaAPI('POST', '/index.php/api/v1/appointments', cuerpo);
}

// ---------------------------------------------------------------
// FUNCIÓN 6: cancelarCita(appointmentId)
// ---------------------------------------------------------------
// Elimina una cita existente por su ID numérico.
// Easy!Appointments libera el cupo inmediatamente.
async function cancelarCita(appointmentId) {
  return llamadaAPI('DELETE', `/index.php/api/v1/appointments/${appointmentId}`);
}

// ---------------------------------------------------------------
// FUNCIÓN 7: obtenerCitasDelCliente(email)
// ---------------------------------------------------------------
// Devuelve las citas activas de un cliente buscando por email.
// Como usamos emails ficticios con el DNI, la búsqueda es:
//   obtenerCitasDelCliente('dni_30123456@municipio.local')
async function obtenerCitasDelCliente(email) {
  const ruta = `/index.php/api/v1/appointments?q=${encodeURIComponent(email)}`;
  return llamadaAPI('GET', ruta);
}

// ---------------------------------------------------------------
// EXPORTACIONES
// ---------------------------------------------------------------
module.exports = {
  obtenerServicios,
  obtenerProveedores,
  obtenerDisponibilidad,
  obtenerDisponibilidadServicio,
  crearCita,
  cancelarCita,
  obtenerCitasDelCliente,
};