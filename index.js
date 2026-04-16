// =============================================================
// index.js — Bot de Telegram con flujo conversacional completo
//             y persistencia real en archivo JSON
// =============================================================

// ---------------------------------------------------------------
// 1. CARGAR VARIABLES DE ENTORNO
// ---------------------------------------------------------------
require('dotenv').config();

// ---------------------------------------------------------------
// 2. IMPORTAR DEPENDENCIAS
// ---------------------------------------------------------------
const logger  = require('./logger');
const express = require('express');

// "fs" (File System) es un módulo nativo de Node.js (no necesita instalarse).
// Nos permite leer y escribir archivos en el disco, que es cómo lograremos
// la persistencia real de los datos.
const fs = require('fs');

// "path" es otro módulo nativo de Node.js que ayuda a construir rutas
// de archivos de forma segura, sin importar el sistema operativo
// (Windows usa "\", Linux/Mac usan "/").
const path = require('path');

// "https" es el módulo nativo de Node.js para hacer solicitudes HTTP seguras (HTTPS).
// Lo usamos para consultar la API de feriados argentinos sin instalar dependencias externas.
const https = require('https');

// "crypto" es el módulo nativo de Node.js para operaciones criptográficas.
// Lo usamos para calcular el HMAC-SHA256 que permite verificar que cada
// solicitud POST al webhook fue firmada realmente por Meta y no por alguien
// que encontró nuestra URL pública. No requiere instalación: viene con Node.js.
const crypto = require('crypto');

// "ea" es el módulo de integración con Easy!Appointments.
// Centraliza todas las llamadas a la API del motor de reservas:
// obtener servicios, consultar disponibilidad, crear y cancelar citas.
// Al importarlo acá, index.js puede usar esas funciones sin conocer
// los detalles de cómo se comunica con la API.
const ea = require('./ea');

// ---------------------------------------------------------------
// 3. RUTA AL ARCHIVO DE LA BASE DE DATOS
// ---------------------------------------------------------------
// Construimos la ruta absoluta al archivo JSON de usuarios.
// __dirname es una variable especial de Node.js que contiene
// la carpeta donde está este archivo (index.js).
// path.join() une las partes de la ruta con el separador correcto.
const RUTA_DB = path.join(__dirname, 'data', 'usuarios.json');

// ---------------------------------------------------------------
// 4. FUNCIONES DE ACCESO A LA BASE DE DATOS
// ---------------------------------------------------------------

// leerUsuarios(): Lee el archivo JSON del disco y lo convierte en un
// array de objetos JavaScript. Lo llamamos "leer" en vez de usar
// require() porque require() guarda el resultado en caché (memoria)
// y no reflejaría los cambios que hacemos al guardar nuevos usuarios.
function leerUsuarios() {
  // El try/catch previene que el bot se apague ante fallos de I/O:
  // si el archivo no existe, está corrupto o es ilegible, el error
  // queda contenido aquí y la función devuelve un array vacío como
  // red de seguridad, en lugar de propagar una excepción no controlada.
  try {
    if (!fs.existsSync(RUTA_DB)) {
      return [];
    }
    const contenido = fs.readFileSync(RUTA_DB, 'utf-8');
    // JSON.parse() convierte el texto JSON en un objeto JavaScript utilizable.
    return JSON.parse(contenido);
  } catch (error) {
    logger.error('Error al leer el archivo de usuarios:', error);
    return [];
  }
}

// guardarUsuarios(): Recibe el array completo de usuarios y lo
// sobreescribe en el archivo JSON del disco, haciendo los cambios permanentes.
function guardarUsuarios(arrayUsuarios) {
  // El try/catch previene que el bot se apague ante fallos de I/O:
  // si el disco está lleno, los permisos fallan o hay un error de escritura,
  // el error queda contenido aquí en lugar de tumbar el proceso completo.
  try {
    // JSON.stringify() convierte el array JavaScript de vuelta a texto JSON.
    // El tercer argumento (2) agrega sangría de 2 espacios para que el archivo
    // sea legible si lo abrimos con un editor de texto.
    const contenidoJson = JSON.stringify(arrayUsuarios, null, 2);
    fs.writeFileSync(RUTA_DB, contenidoJson, 'utf-8');
  } catch (error) {
    logger.error('Error al guardar en el archivo de usuarios:', error);
  }
}

// buscarUsuarioPorDni(): Lee los usuarios frescos del disco y busca
// el que coincida con el DNI recibido.
// Devuelve el objeto del usuario si lo encuentra, o undefined si no.
function buscarUsuarioPorDni(dni) {
  const usuarios = leerUsuarios();
  return usuarios.find((usuario) => usuario.dni === dni.trim());
}

// ---------------------------------------------------------------
// 5. CATÁLOGO DE TRÁMITES DISPONIBLES
// ---------------------------------------------------------------
// TRAMITES: array de strings con los nombres visibles de cada trámite.
// Se carga dinámicamente desde Easy!Appointments al iniciar el bot.
// Sigue siendo un array de strings para que toda la lógica de índices
// y callbacks del bot no necesite cambios: TRAMITES[0], TRAMITES[1], etc.
let TRAMITES = [];

// TRAMITES_COMPLETOS: array de objetos con todos los datos del servicio
// tal como los devuelve Easy!Appointments: { id, name, duration, ... }.
// Necesitamos los IDs numéricos para consultar disponibilidad y crear citas.
// Siempre se carga junto con TRAMITES y tienen el mismo orden.
let TRAMITES_COMPLETOS = [];

// cargarTramites(): consulta la API de Easy!Appointments y llena las dos
// variables de arriba. Se llama al iniciar el bot.
// Si la API no responde, TRAMITES queda vacío y el error aparece en el log.
// El bot sigue funcionando y avisará al usuario si intenta sacar un turno
// mientras los trámites no están disponibles.
async function cargarTramites() {
  try {
    const servicios = await ea.obtenerServicios();
    if (!servicios || servicios.length === 0) {
      console.warn('⚠️  No se encontraron trámites en Easy!Appointments.');
      return;
    }
    TRAMITES_COMPLETOS = servicios;
    TRAMITES = servicios.map((s) => s.name);
    logger.info(`✅ Trámites cargados: ${TRAMITES.join(', ')}`);
  } catch (error) {
    logger.error('❌ Error al cargar trámites desde Easy!Appointments:', error.message);
  }
}

// Devuelve un array con los próximos N días hábiles (lunes a viernes) a partir de hoy.
function proximosDiasHabiles(cantidad) {
  const dias = [];
  const fecha = new Date();
  while (dias.length < cantidad) {
    fecha.setDate(fecha.getDate() + 1);
    const diaSemana = fecha.getDay(); // 0 = Domingo, 6 = Sábado
    if (diaSemana !== 0 && diaSemana !== 6) {
      dias.push(new Date(fecha));
    }
  }
  return dias;
}

// Formatea un objeto Date como texto legible en español (ej: "martes 17 de marzo").
// Se usa en mensajes de texto normales donde el espacio no es limitado.
function formatearFechaTexto(fecha) {
  return fecha.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

// Formatea un objeto Date como "DD/MM" (dos dígitos día / dos dígitos mes).
// Se usa únicamente en títulos de botones y filas de lista, donde el espacio
// es muy limitado (máximo 20 caracteres en botones, 24 en filas de lista de WhatsApp).
// Ejemplo: 5 de abril → "05/04"
function formatearFechaCorta(fecha) {
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}`;
}

// Formatea un objeto Date como string compacto para usar en callback_data (ej: "2026-03-17").
function formatearFechaClave(fecha) {
  return fecha.toISOString().split('T')[0];
}

// Construye el título de una fila de lista para mostrar un turno existente,
// respetando el límite de 24 caracteres que impone WhatsApp en cada fila.
//
// Cálculo del espacio disponible para el nombre del trámite:
//   24 (límite total de la fila)
//   - fecha.length    (ej: "14/04" son 5 caracteres)
//   - horario.length  (ej: "10:00" son 5 caracteres)
//   - 2               (los dos espacios que separan las tres partes)
//   = caracteres que le quedan al nombre del trámite
//
// Si el nombre entra completo, se usa tal cual.
// Si no entra, se recorta y se agrega "…" para indicar que fue cortado.
// Formato final: "NombreTrámite DD/MM HH:MM"
function formatearTituloTurno(tramiteNombre, fecha, horario) {
  const espacioDisponible = 24 - fecha.length - horario.length - 2;
  const nombreTruncado = tramiteNombre.length <= espacioDisponible
    ? tramiteNombre
    : tramiteNombre.substring(0, espacioDisponible - 1) + '…';
  return `${nombreTruncado} ${fecha} ${horario}`;
}

// Devuelve true si la cita todavía no ocurrió (su inicio es posterior a ahora).
// Se usa para filtrar turnos vencidos de todas las listas que ve el vecino:
// nadie debería ver, modificar ni cancelar un turno que ya pasó.
// cita.start viene de EA en formato "YYYY-MM-DD HH:MM:SS", que JavaScript
// convierte directamente a Date sin necesidad de parseo manual.
function esCitaFutura(cita) {
  return new Date(cita.start) > new Date();
}

// Construye el texto legible de una semana hábil dado su primer y último día.
// Formato corto para que entre dentro del límite de 24 caracteres de WhatsApp:
//   — Mismo mes:     "13-17 de abril"
//   — Meses distintos: "28 abr - 2 may"  (mes abreviado para no exceder el límite)
function construirLabelSemana(primero, ultimo) {
  const dia1 = primero.getDate();
  const dia2 = ultimo.getDate();
  const mes1 = primero.toLocaleDateString('es-AR', { month: 'long' });
  const mes2 = ultimo.toLocaleDateString('es-AR', { month: 'long' });

  if (mes1 === mes2) {
    // Mismo mes: "13-17 de abril" (máximo ~20 caracteres con septiembre)
    return `${dia1}-${dia2} de ${mes1}`;
  }

  // Meses distintos: usamos abreviatura para no superar los 24 caracteres del título.
  // toLocaleDateString con month:'short' devuelve "abr.", "may.", etc.; quitamos el punto.
  const mes1corto = primero.toLocaleDateString('es-AR', { month: 'short' }).replace('.', '');
  const mes2corto = ultimo.toLocaleDateString('es-AR',  { month: 'short' }).replace('.', '');
  return `${dia1} ${mes1corto} - ${dia2} ${mes2corto}`;
}

// ---------------------------------------------------------------
// FUNCIÓN: obtenerFeriadosArgentinos()
// ---------------------------------------------------------------
// Consulta la API pública argentinadatos.com para obtener la lista
// de feriados nacionales del año actual.
//
// Devuelve un Set de strings con fechas en formato "YYYY-MM-DD".
// Un Set es como un array pero sin duplicados y con búsqueda instantánea:
// en lugar de recorrer toda la lista para saber si una fecha es feriado,
// basta con hacer feriados.has("2026-05-25"), que responde en tiempo constante.
//
// Si la consulta falla por cualquier motivo (sin internet, API caída, etc.),
// la función devuelve un Set vacío para que el bot siga funcionando con
// normalidad; en el peor caso, el usuario verá feriados como días disponibles.
async function obtenerFeriadosArgentinos() {

  // Obtenemos el año en curso (por ejemplo, 2026).
  // Esto permite que la función sea correcta sin modificarla cada año.
  const año = new Date().getFullYear();

  // Armamos la URL completa de la API con el año actual.
  // Ejemplo: "https://api.argentinadatos.com/v1/feriados/2026"
  const url = `https://api.argentinadatos.com/v1/feriados/${año}`;

  // try/catch: si algo dentro del bloque "try" lanza un error,
  // el programa no se cae; en cambio, salta al bloque "catch"
  // donde decidimos qué hacer con ese error (en este caso, loguearlo y seguir).
  try {

    // https.get() usa callbacks (funciones que se llaman cuando llega la respuesta),
    // pero nosotros queremos usar async/await. Para eso, envolvemos la llamada
    // en una "Promise": una promesa de que en algún momento habrá un resultado.
    // resolve() indica éxito; reject() indica error.
    const datos = await new Promise((resolve, reject) => {

      // Iniciamos la solicitud GET a la URL de feriados.
      https.get(url, (res) => {

        // La respuesta llega en fragmentos ("chunks"). Los acumulamos en 'body'.
        let body = '';
        res.on('data', (chunk) => { body += chunk; });

        // Cuando ya no hay más fragmentos, el evento 'end' se dispara.
        res.on('end', () => {
          try {
            // Convertimos el texto JSON recibido en un array de objetos JavaScript.
            // Si el texto no es JSON válido, JSON.parse() lanza un error
            // que captura el catch interior y rechaza la Promise.
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`No se pudo parsear la respuesta de feriados: ${body}`));
          }
        });

      // Si hay un error de red (sin conexión, DNS, timeout, etc.),
      // rechazamos la Promise para que el catch exterior lo capture.
      }).on('error', reject);
    });

    // La API devuelve un array de objetos con esta forma:
    // [{ fecha: "2026-05-25", nombre: "Día de la Patria", tipo: "inamovible" }, ...]
    // Nos quedamos solo con la propiedad "fecha" de cada elemento
    // y construimos un Set para búsquedas rápidas en proximasSemanas().
    return new Set(datos.map((f) => f.fecha));

  } catch (err) {

    // Algo falló: lo registramos en el log para poder diagnosticarlo después.
    // Usamos logger.error porque es un problema que merece atención,
    // aunque no sea fatal para el funcionamiento del bot.
    logger.error(`No se pudieron obtener los feriados: ${err.message}`);

    // Devolvemos un Set vacío. El código que llama a esta función
    // puede seguir trabajando sin cambios: simplemente no habrá feriados filtrados.
    return new Set();
  }
}

// ---------------------------------------------------------------
// FUNCIÓN: proximasSemanas(cantidadDias)
// ---------------------------------------------------------------
// Devuelve un array de objetos semana { label, fechaInicio, fechaFin } con los
// días hábiles disponibles dentro de los próximos cantidadDias días corridos,
// agrupados por semana calendario (lunes–viernes).
//
// CAMBIO respecto a la versión anterior:
//   — La función ahora es "async" porque necesita esperar el resultado
//     de obtenerFeriadosArgentinos(), que hace una consulta a internet.
//     Una función async siempre devuelve una Promise; quien la llama
//     debe usar "await" para obtener el valor final.
//   — Se agrega el filtro de feriados: además de descartar sábados y domingos,
//     ahora también se descartan los días que aparecen en el Set de feriados.
async function proximasSemanas(cantidadDias) {
  const hoy = new Date();
  const semanasMap = new Map(); // clave: fecha del lunes de esa semana → [Date, ...]

  // NUEVO: consultamos la API de feriados antes de recorrer los días.
  // "await" pausa la función hasta que obtenerFeriadosArgentinos() termine
  // y devuelva el Set con las fechas. Si la consulta falla, recibimos un Set vacío
  // y el loop sigue sin filtrar feriados (comportamiento degradado pero funcional).
  const feriados = await obtenerFeriadosArgentinos();

  for (let i = 0; i <= cantidadDias; i++) {
    const fecha = new Date(hoy);
    fecha.setDate(hoy.getDate() + i);
    const dow = fecha.getDay(); // 0 = domingo, 6 = sábado

    // Descartamos fines de semana (igual que antes).
    if (dow === 0 || dow === 6) continue;

    // NUEVO: convertimos la fecha a "YYYY-MM-DD" para compararla con el Set.
    // formatearFechaClave() ya existe en este archivo y hace exactamente eso.
    const fechaClave = formatearFechaClave(fecha);

    // NUEVO: si la fecha está en el Set de feriados, la saltamos.
    // feriados.has() devuelve true si el string está en el Set, false si no.
    if (feriados.has(fechaClave)) continue;

    // Calculamos el lunes de la semana para usarlo como clave de agrupación.
    // (Sin cambios respecto a la versión anterior.)
    const lunes = new Date(fecha);
    lunes.setDate(fecha.getDate() - (dow - 1));
    const clave = formatearFechaClave(lunes);

    if (!semanasMap.has(clave)) semanasMap.set(clave, []);
    semanasMap.get(clave).push(new Date(fecha));
  }

  // Convertimos el Map en el array de objetos semana. (Sin cambios.)
  return [...semanasMap.values()].map((dias) => {
    const primero = dias[0];
    const ultimo  = dias[dias.length - 1];
    return {
      label:       construirLabelSemana(primero, ultimo),
      fechaInicio: formatearFechaClave(primero),
      fechaFin:    formatearFechaClave(ultimo),
    };
  });
}

// Convierte el array de semanas en filas del Inline Keyboard.
// callback_data: "semana_YYYY-MM-DD_YYYY-MM-DD" (fechaInicio_fechaFin).
// Siempre agrega al final un botón para volver al selector de trámite.
function construirBotonesSemanas(semanas) {
  const filas = semanas.map((s) => ([{
    text: s.label,
    callback_data: `semana_${s.fechaInicio}_${s.fechaFin}`,
  }]));
  // Título acortado para respetar el límite de 24 caracteres del botón de lista de WhatsApp.
  filas.push([{ text: '↩️ Volver', callback_data: 'volver_tramites' }]);
  return filas;
}

// (construirTecladoGestion eliminada: código muerto de la versión Telegram,
//  reemplazada por opcionesGestion() y nunca invocada en el archivo.)


// ---------------------------------------------------------------
// FUNCIÓN: opcionesGestion(tieneTurnos)
// ---------------------------------------------------------------
// Versión de construirTecladoGestion() adaptada para enviarLista().
// Devuelve un array de { id, titulo } con las opciones del menú de gestión.
// "Finalizar" ya NO está incluido en la lista: el vecino puede escribir
// la palabra "Finalizar" directamente para salir, y el pie del mensaje se lo indica.
function opcionesGestion(tieneTurnos) {
  const opciones = [
    { id: 'nuevo_tramite', titulo: '➕ Nuevo Trámite' },
  ];
  if (tieneTurnos) {
    opciones.push({ id: 'modificar_turno', titulo: '✏️ Modificar Turno' });
    opciones.push({ id: 'cancelar_turno',  titulo: '❌ Cancelar Turno'  });
  }
  return opciones;
}

// ---------------------------------------------------------------
// FUNCIÓN: enviarMenuGestion(chatId, texto, tieneTurnos)
// ---------------------------------------------------------------
// Envía el menú de gestión eligiendo el componente visual más adecuado
// según la cantidad de opciones que tenga el vecino en ese momento:
//
//   — Con turnos activos (tieneTurnos = true): hay 4 opciones (Nuevo Trámite,
//     Modificar, Cancelar, Finalizar). Como WhatsApp solo permite 3 botones de
//     respuesta rápida, usamos una lista desplegable que no tiene ese límite.
//
//   — Sin turnos activos (tieneTurnos = false): solo hay 2 opciones (Nuevo Trámite
//     y Finalizar). Con tan pocas opciones, los botones de respuesta rápida son más
//     directos y cómodos que abrir una lista, por eso los usamos en este caso.
async function enviarMenuGestion(chatId, texto, tieneTurnos) {
  if (tieneTurnos) {
    // Lista desplegable: con turnos activos hay 3 acciones (Nuevo, Modificar, Cancelar).
    // "Finalizar" se quitó de la lista; en su lugar agregamos una línea al pie del
    // mensaje para que el vecino sepa que puede escribir la palabra para terminar.
    const textoConPie = texto + '\n\nSi querés terminar, escribí *Finalizar*.';
    return enviarLista(chatId, textoConPie, opcionesGestion(true));
  }
  // Sin turnos → 2 opciones: usamos botones de respuesta rápida.
  // "Finalizar" se conserva como botón porque aquí no hay lista desplegable.
  return enviarBotones(chatId, texto, [
    { id: 'nuevo_tramite',    titulo: '➕ Nuevo Trámite' },
    { id: 'finalizar_sesion', titulo: '🔚 Finalizar'     },
  ]);
}

// ---------------------------------------------------------------
// FUNCIÓN: opcionesSemanas(semanas)
// ---------------------------------------------------------------
// Versión de construirBotonesSemanas() adaptada para enviarLista().
// Convierte el array de semanas (de proximasSemanas()) al formato
// { id, titulo } que espera enviarLista().
function opcionesSemanas(semanas) {
  const opciones = semanas.map((s) => ({
    id:     `semana_${s.fechaInicio}_${s.fechaFin}`,
    titulo: s.label,
  }));
  // Título acortado para respetar el límite de 24 caracteres de las filas de lista de WhatsApp.
  opciones.push({ id: 'volver_tramites', titulo: '↩️ Volver' });
  return opciones;
}

// ---------------------------------------------------------------
// FUNCIÓN: opcionesTramites(indicesPermitidos)
// ---------------------------------------------------------------
// Versión de teclasMenuTramites() adaptada para enviarLista().
// Devuelve un array de { id, titulo } con los trámites disponibles.
// "Cancelar" ya NO está incluido en la lista: el vecino puede escribir
// la palabra "Cancelar" directamente, y el pie del mensaje se lo recuerda.
function opcionesTramites(indicesPermitidos) {
  const indices = indicesPermitidos !== undefined
    ? indicesPermitidos
    : TRAMITES.map((_, i) => i);
  const opciones = indices.map((i) => ({ id: `tramite_${i}`, titulo: TRAMITES[i] }));
  return opciones;
}

// ---------------------------------------------------------------
// 6. VALIDAR CREDENCIALES DE WHATSAPP
// ---------------------------------------------------------------
// Meta for Developers requiere cuatro valores para que el bot pueda
// operar con la API de WhatsApp Business:
//
//   WHATSAPP_VERIFY_TOKEN → string secreto que vos elegís y registrás
//     en el panel de Meta. Meta lo usa para confirmar que la URL del
//     webhook es tuya (ver endpoint GET /webhook más abajo).
//
//   WHATSAPP_TOKEN → token de acceso que genera Meta. Se incluye en
//     cada llamada a la API para autenticar al bot como remitente.
//
//   WHATSAPP_PHONE_ID → identificador del número de teléfono registrado
//     en Meta. Se usa en la URL de la API al enviar mensajes.
//
//   WHATSAPP_APP_SECRET → clave secreta de la aplicación en Meta for Developers.
//     Meta usa esta misma clave para firmar cada solicitud POST al webhook con
//     un HMAC-SHA256. Nosotros la usamos para recalcular esa firma y verificar
//     que el mensaje viene realmente de Meta (ver endpoint POST /webhook más abajo).
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_TOKEN        = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID     = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_APP_SECRET   = process.env.WHATSAPP_APP_SECRET;

if (!WHATSAPP_VERIFY_TOKEN || !WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !WHATSAPP_APP_SECRET) {
  logger.error('❌ Faltan variables de entorno de WhatsApp. Verificar WHATSAPP_VERIFY_TOKEN, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID y WHATSAPP_APP_SECRET en .env');
  process.exit(1);
}

// ---------------------------------------------------------------
// 7. CREAR LA APLICACIÓN EXPRESS Y LOS ENDPOINTS DE WEBHOOK
// ---------------------------------------------------------------
// Express es un framework web para Node.js que nos permite recibir
// solicitudes HTTP. Meta envía los mensajes de WhatsApp a nuestra
// aplicación via HTTP POST, por eso necesitamos un servidor web
// en lugar del polling que usábamos con Telegram.
const app = express();

// express.json() hace que Express entienda automáticamente el cuerpo
// de las solicitudes POST que llegan en formato JSON (que es lo que
// envía Meta con cada mensaje). Sin esto, req.body estaría vacío.
//
// El callback "verify" es una función especial que express.json() ejecuta
// ANTES de parsear el JSON. Acá capturamos el body en su forma cruda (bytes
// sin interpretar) y lo guardamos en req.rawBody.
// Necesitamos el body crudo porque la firma HMAC que Meta envía fue calculada
// sobre exactamente esos bytes, no sobre el objeto JavaScript parseado.
// Si comparáramos usando req.body (ya parseado y re-serializado), los bytes
// podrían diferir y la comparación fallaría aunque el mensaje sea legítimo.
app.use(express.json({
  verify: (req, _res, buf) => {
    // buf es un Buffer (secuencia de bytes) con el body sin tocar.
    // Lo guardamos en req.rawBody para usarlo en la verificación HMAC del webhook.
    req.rawBody = buf;
  }
}));

// ---------------------------------------------------------------
// ENDPOINT GET /webhook — Verificación del webhook por Meta
// ---------------------------------------------------------------
// Antes de que Meta empiece a enviarnos mensajes, necesita confirmar
// que la URL que le dimos realmente pertenece a nuestra aplicación.
// Para eso hace una solicitud GET con tres parámetros en la URL:
//   hub.mode         → siempre "subscribe"
//   hub.verify_token → el string secreto que configuramos en Meta
//   hub.challenge    → un número aleatorio que debemos devolver tal cual
//
// Si devolvemos el challenge correctamente, Meta activa el webhook.
// Si no, Meta no enviará ningún mensaje a esta URL.
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Verificamos que sea una solicitud de suscripción y que el token
  // coincida con el que configuramos en las variables de entorno.
  if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
    logger.info('✅ Webhook de WhatsApp verificado correctamente.');
    // Respondemos con el challenge para que Meta confíe en nuestra URL.
    res.status(200).send(challenge);
  } else {
    // El token no coincide: rechazamos con 403 (Prohibido).
    // Esto evita que cualquiera pueda activar el webhook con una URL falsa.
    logger.error('❌ Verificación de webhook fallida: token inválido o mode incorrecto.');
    res.sendStatus(403);
  }
});

// ---------------------------------------------------------------
// ENDPOINT POST /webhook — Recepción de mensajes de WhatsApp
// ---------------------------------------------------------------
// Meta envía cada mensaje entrante (y notificaciones de estado de
// entrega) como una solicitud POST a esta URL.
//
// IMPORTANTE: antes de procesar cualquier mensaje verificamos la firma
// HMAC-SHA256 que Meta incluye en el header "x-hub-signature-256".
// Esto garantiza que la solicitud viene realmente de Meta y no de alguien
// que encontró nuestra URL pública y quiere inyectar mensajes falsos.
//
// ¿Qué es HMAC? Es un algoritmo que combina un mensaje con una clave
// secreta para producir una "huella" única. Solo quien tiene la clave
// puede producir esa huella, entonces si la huella coincide, el mensaje
// es auténtico. Meta calcula el HMAC-SHA256 del body usando WHATSAPP_APP_SECRET
// como clave, y nosotros recalculamos lo mismo para comparar.
app.post('/webhook', async (req, res) => {

  // ── PASO 1: leer la firma que Meta incluyó en el header ──────────────────
  // Meta envía el header en el formato: "sha256=<hash_en_hexadecimal>"
  const firmaHeader = req.headers['x-hub-signature-256'];

  if (!firmaHeader) {
    // Si el header no existe, la solicitud no pasó por el sistema de Meta.
    // Rechazamos con 401 (No autorizado) y dejamos registro del intento.
    logger.error('❌ Webhook rechazado: falta el header x-hub-signature-256.');
    return res.sendStatus(401);
  }

  // ── PASO 2: recalcular el HMAC-SHA256 del body crudo ─────────────────────
  // Usamos el módulo nativo "crypto" para crear un HMAC con el algoritmo
  // SHA-256 y la clave secreta WHATSAPP_APP_SECRET.
  // Luego lo "alimentamos" con los bytes crudos del body (req.rawBody,
  // capturado antes del parseo en la configuración de express.json).
  // digest('hex') convierte el resultado binario a texto hexadecimal,
  // igual que el formato que usa Meta.
  const hashCalculado = crypto
    .createHmac('sha256', WHATSAPP_APP_SECRET)
    .update(req.rawBody)
    .digest('hex');

  // Agregamos el prefijo "sha256=" para que el formato sea idéntico al header.
  const firmaCalculada = `sha256=${hashCalculado}`;

  // ── PASO 3: comparar con crypto.timingSafeEqual() ─────────────────────────
  // ¿Por qué no usar simplemente firmaHeader === firmaCalculada?
  // Porque una comparación normal con === se detiene en el primer carácter
  // diferente, y eso permite medir tiempos de respuesta para adivinar la firma
  // carácter a carácter (ataque de "timing"). crypto.timingSafeEqual() siempre
  // tarda el mismo tiempo sin importar en qué posición difieren las cadenas,
  // eliminando ese canal de ataque.
  // Requiere Buffers de igual longitud, por eso convertimos ambas cadenas.
  const bufferHeader    = Buffer.from(firmaHeader);
  const bufferCalculada = Buffer.from(firmaCalculada);

  const firmaValida =
    bufferHeader.length === bufferCalculada.length &&
    crypto.timingSafeEqual(bufferHeader, bufferCalculada);

  if (!firmaValida) {
    // Las firmas no coinciden: la solicitud fue alterada o no viene de Meta.
    logger.error('❌ Webhook rechazado: firma HMAC-SHA256 inválida.');
    return res.sendStatus(401);
  }

  // ── PASO 4: la firma es válida → procesar el mensaje ─────────────────────
  // Solo llegamos acá si Meta firmó correctamente la solicitud.
  // Respondemos 200 de inmediato para que Meta no reintente el envío
  // (si no recibe el 200 en pocos segundos, lo considera un fallo y reenvía,
  // generando mensajes duplicados).
  res.sendStatus(200);

  try {
    // procesarMensajeEntrante() extrae los datos del payload de Meta
    // y ejecuta toda la lógica conversacional.
    await procesarMensajeEntrante(req.body);
  } catch (err) {
    // Logueamos el error pero no propagamos la excepción: el 200 ya fue enviado
    // y no hay nada más que hacer desde el punto de vista del protocolo.
    logger.error('❌ Error al procesar mensaje entrante de WhatsApp: ' + err.message);
  }
});

// ---------------------------------------------------------------
// FUNCIÓN: enviarMensaje(telefono, texto)
// ---------------------------------------------------------------
// Envía un mensaje de texto a un número de WhatsApp a través de la
// Graph API de Meta (versión 25.0).
//
// Parámetros:
//   telefono  → número en formato internacional sin "+" (ej: "5492944123456")
//   texto     → contenido del mensaje a enviar
//   _opciones → se acepta para mantener compatibilidad con las llamadas
//               existentes que aún pasan parse_mode o reply_markup, pero
//               se ignora por ahora. Se implementará en la siguiente etapa.
async function enviarMensaje(telefono, texto, _opciones) {

  // Armamos la URL del endpoint de mensajes con el ID de número de teléfono.
  // Cada número registrado en Meta tiene su propio PHONE_ID.
  const urlStr = `https://graph.facebook.com/v25.0/${WHATSAPP_PHONE_ID}/messages`;
  const urlObj = new URL(urlStr);

  // ---------------------------------------------------------------
  // ---------------------------------------------------------------
  // NORMALIZACIÓN DEL NÚMERO DE TELÉFONO
  // ---------------------------------------------------------------
  // La API de Meta requiere el formato E.164: "+" seguido del código de país
  // y el número sin espacios ni guiones.
  //
  // CASO ESPECIAL — ARGENTINA (549...):
  // Los números argentinos llegan del webhook con un "9" extra después del
  // código de país: "549XXXXXXXXXX". Ese "9" es un artefacto histórico de
  // la telefonía celular argentina que WhatsApp incluye en el wa_id pero
  // que Meta NO acepta en el campo "to" al enviar. Si lo dejamos, el envío
  // falla. La solución es quitarlo: "549..." → "+54...".
  //
  // CASO ARGENTINO SIN EL 9 (54...):
  // Si el número ya viene sin el "9" (empieza directamente con "54"),
  // solo agregamos el "+".
  //
  // CASO GENERAL:
  // Para cualquier otro número, agregamos "+" si no lo tiene.
  let telefonoNormalizado;
  if (telefono.startsWith('549')) {
    // Quitamos el "9" extra: descartamos los 3 primeros caracteres ("549")
    // y los reemplazamos por "+54".
    telefonoNormalizado = '+54' + telefono.slice(3);
  } else if (telefono.startsWith('54')) {
    // Ya sin el "9": solo agregamos el "+".
    telefonoNormalizado = '+' + telefono;
  } else if (telefono.startsWith('+')) {
    // Cualquier número que ya trae "+": lo dejamos tal cual.
    telefonoNormalizado = telefono;
  } else {
    // Resto de países: agregamos "+" y listo.
    telefonoNormalizado = '+' + telefono;
  }

  // Construimos el cuerpo del mensaje en el formato que exige la API de Meta:
  //   messaging_product → siempre "whatsapp" para esta API
  //   to                → número de destino en formato internacional
  //   type              → "text" para mensajes de texto plano
  //   text.body         → el contenido visible del mensaje
  const bodyStr = JSON.stringify({
    messaging_product: 'whatsapp',
    to:   telefonoNormalizado,
    type: 'text',
    text: { body: texto },
  });

  // Envolvemos la llamada HTTPS en una Promise para poder usar async/await.
  // En lugar de reject(), usamos resolve(null) en los errores para que un
  // fallo al enviar un mensaje no interrumpa el flujo conversacional.
  return new Promise((resolve) => {

    const opciones = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'POST',
      headers: {
        // El token de acceso autentica cada llamada a la API de Meta.
        'Authorization':  `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type':   'application/json',
        // Content-Length es obligatorio en POST para que el servidor
        // sepa cuántos bytes leer del cuerpo.
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(opciones, (res) => {
      let data = '';
      // La respuesta llega en fragmentos; los acumulamos.
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // Éxito: cualquier código 2xx es aceptable.
          resolve(null);
        } else {
          // Error HTTP: logueamos pero resolvemos para no cortar el flujo.
          logger.error(`❌ Error al enviar mensaje de WhatsApp (HTTP ${res.statusCode}): ${data}`);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      // Error de red (sin conexión, DNS, etc.): logueamos y resolvemos.
      logger.error(`❌ Error de red al enviar mensaje a ${telefono}: ${err.message}`);
      resolve(null);
    });

    // Timeout de 30 segundos: si la API no responde, cancelamos la solicitud.
    req.setTimeout(30000, () => {
      req.destroy(new Error('Timeout al enviar mensaje de WhatsApp'));
    });

    // Escribimos el cuerpo JSON y cerramos la solicitud para enviarla.
    req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------
// FUNCIÓN: enviarMensajeInteractivo(telefono, tipo, cuerpo, acciones)
// ---------------------------------------------------------------
// Envía un mensaje interactivo a WhatsApp (lista de opciones o botones
// de respuesta rápida) via la Graph API de Meta.
// Es la función base que usan enviarLista() y enviarBotones() internamente.
//
// Parámetros:
//   telefono → número de destino (se normaliza igual que en enviarMensaje)
//   tipo     → "list" para listas desplegables, "button" para botones de respuesta rápida
//   cuerpo   → texto del mensaje visible antes de las opciones (equivale al
//              texto del mensaje en Telegram al que acompañaban los botones)
//   acciones → objeto con la estructura de opciones según el tipo:
//              - Para "list":   { button: "Ver opciones", sections: [...] }
//              - Para "button": { buttons: [...] }
async function enviarMensajeInteractivo(telefono, tipo, cuerpo, acciones) {

  // Reutilizamos la misma lógica de normalización que en enviarMensaje().
  let telefonoNormalizado;
  if (telefono.startsWith('549')) {
    telefonoNormalizado = '+54' + telefono.slice(3);
  } else if (telefono.startsWith('54')) {
    telefonoNormalizado = '+' + telefono;
  } else if (telefono.startsWith('+')) {
    telefonoNormalizado = telefono;
  } else {
    telefonoNormalizado = '+' + telefono;
  }

  const urlStr = `https://graph.facebook.com/v25.0/${WHATSAPP_PHONE_ID}/messages`;
  const urlObj = new URL(urlStr);

  // El objeto "interactive" es el formato que exige Meta para este tipo de mensaje.
  // "body.text" es el texto que el usuario ve antes de abrir la lista o los botones.
  const bodyStr = JSON.stringify({
    messaging_product: 'whatsapp',
    to:          telefonoNormalizado,
    type:        'interactive',
    interactive: {
      type:   tipo,
      body:   { text: cuerpo },
      action: acciones,
    },
  });

  return new Promise((resolve) => {
    const opciones = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(opciones, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(null);
        } else {
          logger.error(`❌ Error al enviar mensaje interactivo (HTTP ${res.statusCode}): ${data}`);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      logger.error(`❌ Error de red al enviar interactivo a ${telefono}: ${err.message}`);
      resolve(null);
    });

    req.setTimeout(30000, () => {
      req.destroy(new Error('Timeout al enviar mensaje interactivo'));
    });

    // TODO: eliminar este log una vez resuelto el diagnóstico de mensajes interactivos.
    logger.info('📤 enviarMensajeInteractivo body: ' + bodyStr);

    req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------
// FUNCIÓN: enviarLista(telefono, texto, opciones)
// ---------------------------------------------------------------
// Construye y envía un mensaje de tipo "lista" a WhatsApp.
// Las listas muestran un botón "Ver opciones" que al tocarlo despliega
// una hoja con todas las opciones disponibles para elegir una.
// Son el equivalente a los Inline Keyboards de Telegram cuando hay
// más de 3 opciones.
//
// Parámetros:
//   telefono → número de destino
//   texto    → texto del mensaje que aparece antes de la lista
//   opciones → array de { id, titulo }. El id llega en list_reply.id
//              del webhook y equivale al callback_data de Telegram.
async function enviarLista(telefono, texto, opciones) {

  // Convertimos al formato que espera la API de Meta para las filas de una lista.
  // La API limita el título de cada fila a 24 caracteres; truncamos si es necesario.
  const rows = opciones.map((op) => ({
    id:    op.id,
    title: op.titulo.substring(0, 24),
  }));

  // Una lista de WhatsApp agrupa filas en "sections". Usamos una sola sección
  // llamada "Opciones" ya que no necesitamos categorizar las elecciones.
  const acciones = {
    button:   'Ver opciones',
    sections: [{ title: 'Opciones', rows }],
  };

  return enviarMensajeInteractivo(telefono, 'list', texto, acciones);
}

// ---------------------------------------------------------------
// FUNCIÓN: enviarBotones(telefono, texto, botones)
// ---------------------------------------------------------------
// Construye y envía un mensaje con botones de respuesta rápida a WhatsApp.
// A diferencia de las listas, los botones aparecen directamente debajo
// del mensaje. Máximo 3 botones por limitación de la API de Meta.
// Son el equivalente a los botones de confirmación (Sí/No) de Telegram.
//
// Parámetros:
//   telefono → número de destino
//   texto    → texto del mensaje que aparece sobre los botones
//   botones  → array de { id, titulo }, máximo 3 elementos.
//              El id llega en button_reply.id del webhook.
async function enviarBotones(telefono, texto, botones) {

  // Convertimos al formato que espera la API para botones de tipo "reply".
  // La API limita el título de cada botón a 20 caracteres; truncamos si es necesario.
  // Tomamos como máximo 3 botones (límite de la API de Meta).
  const buttons = botones.slice(0, 3).map((b) => ({
    type:  'reply',
    reply: {
      id:    b.id,
      title: b.titulo.substring(0, 20),
    },
  }));

  return enviarMensajeInteractivo(telefono, 'button', texto, { buttons });
}

cargarTramites();

// ---------------------------------------------------------------
// 8. MEMORIA DE ESTADO DE LAS CONVERSACIONES
// ---------------------------------------------------------------
// Objeto que guarda el estado actual de cada usuario en la conversación.
//
// Estados posibles:
//   - 'INICIAL'               → El usuario no inició ningún flujo aún.
//   - 'ESPERANDO_DNI'         → Le pedimos el DNI, aguardamos su respuesta.
//   - 'ESPERANDO_NOMBRE'      → El DNI no existe; le pedimos nombre y apellido.
//   - 'MENU_GESTION'          → El DNI existe; mostramos el menú de gestión con botones.
//   - 'ESPERANDO_TRAMITE'     → Ya tenemos nombre; le pedimos elegir trámite.
//   - 'ESPERANDO_DIA'         → Trámite elegido; mostramos selector de semanas.
//   - 'ESPERANDO_FECHA'       → Semana elegida; mostramos días hábiles de esa semana.
//   - 'ESPERANDO_HORARIO'     → Fecha elegida; mostramos horarios por Inline Keyboard.
//   - 'ESPERANDO_CANCELACION'              → Mostramos los turnos activos para que elija cuál borrar.
//   - 'ESPERANDO_MODIFICACION'             → Mostramos los turnos activos para que elija cuál modificar.
//   - 'ESPERANDO_CONFIRMACION'             → Mostramos el resumen del turno antes de crear la cita.
//   - 'ESPERANDO_CONFIRMACION_CANCELACION' → Mostramos el resumen del turno antes de cancelarlo.
//
// Ejemplo: { 123456789: 'ESPERANDO_DNI', 987654321: 'ESPERANDO_NOMBRE' }
const estadosUsuarios = {};

// ---------------------------------------------------------------
// 9. MEMORIA TEMPORAL DE REGISTROS EN PROCESO
// ---------------------------------------------------------------
// Cuando un usuario nuevo se está registrando, necesitamos recordar
// los datos que nos fue dando a lo largo de varios mensajes (DNI y nombre)
// para poder armar el objeto completo al final.
//
// Ejemplo: { 123456789: { dni: '30123456', nombre: 'Juan Pérez' } }
const registrosEnProceso = {};

// ---------------------------------------------------------------
// 9b. TEMPORIZADORES DE SESIÓN POR INACTIVIDAD
// ---------------------------------------------------------------
// Cada clave es un chatId; el valor es el ID del setTimeout activo
// para ese usuario. Permite cancelar y renovar el temporizador en
// cada interacción, reiniciando el contador de 10 minutos.
//
// Ejemplo: { 123456789: <Timeout>, 987654321: <Timeout> }
let timeoutsSesion = {};

// ---------------------------------------------------------------
// 10. FUNCIONES AUXILIARES DE LÓGICA
// ---------------------------------------------------------------

// Detecta si el texto es un saludo o una intención de inicio de trámite.
// Cubre saludos comunes, pedidos de turno, consultas y comandos de ayuda.
// Usamos toLowerCase() + normalize() para ignorar mayúsculas y tildes,
// así "Quiero un Turno" y "quiero un turno" se tratan igual.
function esSaludo(texto) {
  const textoNormalizado = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // elimina diacríticos (tildes, ñ → n, etc.)
    .trim();

  const disparadores = [
    // Saludos
    'hola', 'buenas', 'buen dia', 'buenos dias', 'buenas tardes',
    'buenas noches', 'hey', 'ey',
    // Intención directa de turno
    'turno', 'quiero un turno', 'necesito un turno', 'sacar turno',
    'pedir turno', 'reservar turno', 'solicitar turno', 'tramite', 'tramites',
    // Consultas generales
    'consulta', 'informacion', 'info', 'ayuda', 'ayudame',
    'como funciona', 'que puedo hacer', 'que tramites hay',
    // Comandos de texto
    'start', 'comenzar', 'empezar', 'iniciar', 'menu',
  ];

  return disparadores.some((d) => textoNormalizado.includes(d));
}

// Valida que el DNI tenga entre 7 y 8 dígitos numéricos únicamente.
function esDniValido(texto) {
  return /^\d{7,8}$/.test(texto.trim());
}

// Devuelve el mensaje de bienvenida estándar que pide el DNI.
function mensajeBienvenida() {
  return (
    '¡Hola! Soy el asistente de turnos de la Municipalidad de Villa La Angostura. 👋\n\n' +
    'Puedo ayudarte a:\n' +
    '📋 Sacar un turno para tus trámites municipales\n' +
    '✏️ Modificar un turno existente\n' +
    '❌ Cancelar un turno que ya tenés reservado\n\n' +
    'Para comenzar, ingresá tu número de DNI (sin puntos ni espacios):'
  );
}

// (teclasMenuTramites eliminada: código muerto de la versión Telegram,
//  reemplazada por opcionesTramites() y nunca invocada en el archivo.)

// ---------------------------------------------------------------
// 10b. GESTIÓN DE TIMEOUT POR INACTIVIDAD
// ---------------------------------------------------------------
// gestionarTimeout(): Se llama al inicio de cada interacción del usuario
// (mensaje de texto o pulsación de botón). Su trabajo es reiniciar el
// contador de inactividad de 10 minutos para ese chatId.
//
// El try/catch en el bloque interno previene que un fallo al enviar el
// mensaje de expiración apague el bot.
function gestionarTimeout(chatId) {
  // Si ya hay un temporizador activo para este usuario, lo cancelamos.
  // Esto "reinicia el reloj" con cada nueva interacción.
  if (timeoutsSesion[chatId]) {
    clearTimeout(timeoutsSesion[chatId]);
    delete timeoutsSesion[chatId];
  }

  // Si el usuario está en estado INICIAL no hay ningún trámite en curso,
  // por lo que no tiene sentido crear un temporizador de vencimiento.
  if ((estadosUsuarios[chatId] || 'INICIAL') === 'INICIAL') {
    return;
  }

  // Creamos un nuevo temporizador de 10 minutos (600 000 ms).
  // Si el usuario no interactúa antes de que se cumpla, lo devolvemos
  // al estado INICIAL y limpiamos cualquier dato parcial en memoria.
  timeoutsSesion[chatId] = setTimeout(async () => {
    // Limpiamos el registro en proceso (datos parciales del trámite).
    delete registrosEnProceso[chatId];

    // Volvemos al estado neutro para que el usuario deba empezar de cero.
    estadosUsuarios[chatId] = 'INICIAL';

    // Eliminamos la referencia al temporizador ya ejecutado.
    delete timeoutsSesion[chatId];

    // Notificamos al usuario que su sesión expiró.
    // También recordamos las dos palabras clave para retomar o cancelar.
    try {
      await enviarMensaje(
        chatId,
        '⏳ Tu sesión ha expirado por inactividad.\n\n' +
        'Escribí *Menu* para volver al inicio, o *Cancelar* para detener el proceso.',
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error(`Error al enviar mensaje de timeout al usuario ${chatId}:`, error);
    }
  }, 600000);
}

// ---------------------------------------------------------------
// 11. FUNCIÓN PRINCIPAL: procesarMensajeEntrante(body)
// ---------------------------------------------------------------
// Recibe el body completo del webhook de Meta, extrae los datos del
// mensaje entrante y ejecuta toda la lógica conversacional.
//
// Meta puede enviarnos dos tipos de notificaciones POST:
//   a) Mensajes entrantes: el vecino nos escribió algo.
//   b) Notificaciones de estado: el mensaje fue entregado o leído.
// Solo procesamos el tipo a); el tipo b) lo ignoramos silenciosamente.
async function procesarMensajeEntrante(body) {

  // El payload de Meta tiene varios niveles de anidación. Usamos
  // optional chaining (?.) para que si algún nivel no existe, el código
  // no lance un error sino que simplemente devuelva 'undefined'.
  const value = body?.entry?.[0]?.changes?.[0]?.value;

  // Si no hay mensajes en el payload es una notificación de estado
  // (entregado, leído, etc.). Salimos sin hacer nada.
  if (!value?.messages || value.messages.length === 0) return;

  // Tomamos el primer mensaje (Meta normalmente envía uno por notificación).
  const mensaje = value.messages[0];

  // wa_id es el número de teléfono del remitente en formato internacional
  // (por ejemplo "5492944123456"). Cumple el mismo rol que chatId en
  // Telegram: identifica de forma única al usuario en la conversación.
  const chatId = value.contacts?.[0]?.wa_id;
  if (!chatId) return;

  // Si el mensaje es interactivo (respuesta a una lista o un botón de respuesta rápida)
  // extraemos el id de la opción elegida. Ese id es equivalente al callback_data de
  // Telegram: contiene el mismo valor que usábamos allí (ej: "tramite_0", "confirmar_turno").
  // Llamamos a procesarCallback() que contiene toda la lógica de manejo de interacciones.
  if (mensaje.type === 'interactive') {
    // Meta envía list_reply si el usuario eligió de una lista, button_reply si tocó un botón.
    const data = mensaje.interactive?.list_reply?.id || mensaje.interactive?.button_reply?.id;
    if (!data) return;
    // Procesamos el id exactamente igual que procesábamos callback_data en Telegram.
    await procesarCallback(chatId, data);
    return;
  }

  // Si el mensaje no es texto ni interactivo (imagen, audio, video, documento, etc.)
  // avisamos al vecino y salimos.
  if (mensaje.type !== 'text') {
    await enviarMensaje(chatId, 'Por el momento solo puedo procesar mensajes de texto o selecciones de menú. Por favor, escribí Menu para comenzar.');
    return;
  }

  // Extraemos el texto del mensaje. En la API de Meta el contenido está en text.body.
  const texto = mensaje.text.body;

  // A partir de acá la lógica es idéntica al handler de Telegram original.
  // chatId = wa_id del remitente, texto = contenido del mensaje recibido.

  // Reinicio global del flujo: si el usuario escribe "menu", "hola", etc.
  // desde cualquier estado que no sea INICIAL, limpiamos su sesión y lo
  // llevamos directo a pedir el DNI, sin pasar por ninguna rama posterior.
  const estadoActualParaReinicio = estadosUsuarios[chatId] || 'INICIAL';
  if (esSaludo(texto) && estadoActualParaReinicio !== 'INICIAL') {
    delete registrosEnProceso[chatId];
    estadosUsuarios[chatId] = 'ESPERANDO_DNI';
    enviarMensaje(chatId, mensajeBienvenida());
    return;
  }

  // Cancelación global del flujo: si el usuario escribe exactamente "cancelar"
  // (sin importar mayúsculas ni tildes) y está en medio de algún proceso,
  // limpiamos todo y lo devolvemos al estado inicial sin necesidad de
  // que ingrese su DNI de nuevo.
  const textoNormalizado = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes y diacríticos
    .trim();

  if (textoNormalizado === 'cancelar' && estadoActualParaReinicio !== 'INICIAL') {
    delete registrosEnProceso[chatId];   // borramos cualquier dato parcial del trámite
    estadosUsuarios[chatId] = 'INICIAL'; // volvemos al estado neutral
    gestionarTimeout(chatId);            // cancela el timeout activo (no crea uno nuevo porque el estado es INICIAL)
    enviarMensaje(
      chatId,
      'Proceso cancelado. Si necesitás algo más, escribí *Menu* cuando quieras.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Finalización global: si el usuario escribe exactamente "finalizar" desde
  // cualquier estado activo, lo despedimos y limpiamos su sesión completa.
  // Mismo efecto que tocar el botón "🔚 Finalizar" del menú de gestión.
  if (textoNormalizado === 'finalizar' && estadoActualParaReinicio !== 'INICIAL') {
    delete registrosEnProceso[chatId];   // borramos datos del trámite en curso
    estadosUsuarios[chatId] = 'INICIAL'; // volvemos al estado neutral
    gestionarTimeout(chatId);            // cancela el timeout activo
    enviarMensaje(
      chatId,
      '¡Hasta luego! Si necesitás algo más, escribí *Menu* cuando quieras.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Reiniciamos (o cancelamos) el temporizador de inactividad con cada mensaje.
  // Si el usuario está en INICIAL no se crea timeout; en cualquier otro estado
  // el reloj se reinicia desde cero para darle 10 minutos más de sesión activa.
  gestionarTimeout(chatId);

  // Obtenemos el estado actual del usuario (INICIAL si es la primera vez)
  const estadoActual = estadosUsuarios[chatId] || 'INICIAL';

  // Usamos el número de WhatsApp (chatId = wa_id) en lugar del nombre de Telegram.
  logger.info(`📩 WhatsApp (${chatId}) | Estado: ${estadoActual} | Texto: "${texto}"`);

  // ==============================================================
  // RAMA A: Comando /start o saludo en estado INICIAL
  // Ambos disparan el mismo flujo: pedir el DNI.
  // ==============================================================
  if (texto.startsWith('/start') || (estadoActual === 'INICIAL' && esSaludo(texto))) {
    estadosUsuarios[chatId] = 'ESPERANDO_DNI';
    enviarMensaje(chatId, mensajeBienvenida(), { parse_mode: 'Markdown' });
    return;
  }

  // ==============================================================
  // RAMA B: El bot espera que el usuario ingrese su DNI
  // ==============================================================
  if (estadoActual === 'ESPERANDO_DNI') {

    // B1: Validación de formato
    if (!esDniValido(texto)) {
      enviarMensaje(
        chatId,
        '⚠️ El DNI ingresado no es válido.\n' +
        'Tiene que ser solo números, sin puntos ni espacios, y tener entre 7 y 8 dígitos.\n' +
        'Ejemplo: *12345678*\n\n' +
        'Intentá de nuevo o escribí *Menu* para volver al inicio.',
        { parse_mode: 'Markdown' }
      );
      return; // Mantenemos el estado ESPERANDO_DNI para reintento
    }

    const dniIngresado = texto.trim();

    // Consultamos Easy!Appointments buscando por el email ficticio que usamos
    // al crear citas: "dni_NUMERODNI@municipio.local". Si hay citas, el vecino
    // ya está registrado; si no hay ninguna, lo tratamos como nuevo usuario.
    const emailVecino = `dni_${dniIngresado}@municipio.local`;
    let citasActivas;
    try {
      citasActivas = await ea.obtenerCitasDelCliente(emailVecino);
    } catch (error) {
      logger.error(`❌ Error al consultar citas para DNI ${dniIngresado}:`, error.message);
      enviarMensaje(
        chatId,
        '⚠️ Hubo un problema al consultar tu información. Puede ser una falla momentánea.\n\n' +
        'Esperá unos segundos e intentá ingresar tu DNI de nuevo, o escribí *Menu* para volver al inicio.',
        { parse_mode: 'Markdown' }
      );
      // Mantenemos el estado ESPERANDO_DNI para que el vecino pueda reintentar.
      return;
    }

    const nombre      = citasActivas.nombreCliente;
    const citasCargadas = citasActivas.citas ?? [];

    // B2c: nombreCliente es null → el vecino no existe en EA, iniciamos el registro.
    if (!nombre) {
      registrosEnProceso[chatId] = { dni: dniIngresado };
      estadosUsuarios[chatId] = 'ESPERANDO_NOMBRE';

      enviarMensaje(
        chatId,
        'No encontramos registros para tu DNI. Vamos a registrarte.\n' +
        'Por favor, ingresá tu Nombre y Apellido:'
      );
      return;
    }

    // El vecino existe en EA (nombreCliente no es null). Guardamos DNI y nombre
    // anticipadamente para que cualquier acción del menú ya tenga sus datos.
    registrosEnProceso[chatId] = { dni: dniIngresado, nombre };
    estadosUsuarios[chatId] = 'MENU_GESTION';

    // Filtramos los turnos pasados: solo mostramos y contamos los que aún no ocurrieron.
    // Un turno vencido no tiene sentido en el menú porque no se puede modificar ni cancelar.
    const citasFuturas = citasCargadas.filter(esCitaFutura);

    // B2a: El vecino existe Y tiene turnos futuros → mostramos la lista y el menú completo.
    if (citasFuturas.length > 0) {

      const listaTurnos = citasFuturas.map((cita) => {
        const servicio      = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
        const tramiteNombre = servicio ? servicio.name : `Servicio ${cita.serviceId}`;
        const fechaISO      = cita.start.substring(0, 10);
        const fechaTexto    = formatearFechaTexto(new Date(`${fechaISO}T12:00:00`));
        const horario       = cita.start.substring(11, 16);
        return { tramite: tramiteNombre, fecha: fechaTexto, horario };
      });

      const renglonesTurnos = listaTurnos.map((t, i) =>
        `  *${i + 1}.* ${t.tramite} — ${t.fecha} a las ${t.horario} hs`
      );
      const textoBienvenida =
        `👋 Hola *${nombre}*, estos son tus turnos activos:\n\n` +
        renglonesTurnos.join('\n') +
        '\n\n¿Qué querés hacer?';

      // Enviamos el saludo y el menú de gestión (lista porque hay 4 opciones).
      enviarMenuGestion(chatId, textoBienvenida, true);
      return;
    }

    // B2b: El vecino existe pero no tiene turnos futuros → menú reducido como botones (2 opciones).
    // El nombre va entre asteriscos para que aparezca en negrita en WhatsApp.
    enviarMenuGestion(
      chatId,
      `👋 Hola *${nombre}*, no tenés turnos activos por el momento.\n\n¿Qué querés hacer?`,
      false
    );
    return;
  }

  // ==============================================================
  // RAMA C: El bot espera que el usuario ingrese su nombre y apellido
  // ==============================================================
  if (estadoActual === 'ESPERANDO_NOMBRE') {

    const nombreIngresado = texto.trim();

    // Guardamos el nombre en el registro temporal junto al DNI que ya teníamos
    registrosEnProceso[chatId].nombre = nombreIngresado;

    // Pasamos al siguiente estado: elegir el trámite
    estadosUsuarios[chatId] = 'ESPERANDO_TRAMITE';

    // Enviamos la bienvenida con la lista de trámites disponibles.
    // Al pie recordamos que puede escribir "Cancelar" para salir en cualquier momento.
    enviarLista(
      chatId,
      `¡Bienvenido, ${nombreIngresado}! ¿Qué trámite querés realizar?\n\nSi no querés continuar, escribí *Cancelar*.`,
      opcionesTramites()
    );
    return;
  }

  // ==============================================================
  // RAMA D: Mensaje fuera de contexto (estado INICIAL, sin saludo)
  // Nota: la selección de trámite se realiza ahora mediante botones
  // (Inline Keyboard) y se procesa en el manejador callback_query.
  // ==============================================================
  // Construimos un mensaje orientador según el estado actual del usuario.
  // Si está en medio de un flujo, le explicamos qué se espera de él en ese paso.
  // Al pie de cada mensaje recordamos las dos palabras clave disponibles:
  //   — "Cancelar" para abandonar el proceso actual y volver al estado inicial.
  //   — "Menu"     para reiniciar desde cero (pide el DNI de nuevo).
  const mensajesOrientadores = {
    ESPERANDO_DNI:          'Estoy esperando que ingreses tu número de DNI (solo números, sin puntos ni espacios).\n\nEjemplo: *12345678*',
    ESPERANDO_NOMBRE:       'Estoy esperando que ingreses tu nombre y apellido completos.\n\nEjemplo: *Juan Pérez*',
    ESPERANDO_TRAMITE:      'Por favor, usá los botones para elegir el trámite que querés realizar.',
    ESPERANDO_DIA:          'Por favor, usá los botones para elegir la semana en la que querés sacar el turno.',
    ESPERANDO_FECHA:        'Por favor, usá los botones para elegir el día de tu turno.',
    ESPERANDO_HORARIO:      'Por favor, usá los botones para elegir el horario de tu turno.',
    ESPERANDO_CANCELACION:  'Por favor, usá los botones para seleccionar el turno que querés cancelar.',
    ESPERANDO_MODIFICACION: 'Por favor, usá los botones para seleccionar el turno que querés modificar.',
    MENU_GESTION:           'Por favor, usá los botones del menú para elegir qué querés hacer.',
  };

  const orientacion = mensajesOrientadores[estadoActual] || 'No estoy seguro de en qué paso estamos.';

  // Al pie recordamos ambas salidas disponibles: Cancelar (detiene el proceso actual)
  // y Menu (reinicia desde cero pidiendo el DNI nuevamente).
  enviarMensaje(
    chatId,
    `${orientacion}\n\nSi querés detener el proceso, escribí *Cancelar*. Si preferís empezar de cero, escribí *Menu*.`,
    { parse_mode: 'Markdown' }
  );
}

// ---------------------------------------------------------------
// 12. FUNCIÓN: procesarCallback(chatId, data)
// ---------------------------------------------------------------
// Procesa una acción del usuario disparada por un botón o lista de WhatsApp.
// Recibe el chatId (wa_id del usuario) y el id de la opción elegida,
// que es equivalente al callback_data que usábamos en Telegram.
// Es llamada desde procesarMensajeEntrante() cuando llega un mensaje
// de tipo "interactive" (respuesta a lista o botón de respuesta rápida).
async function procesarCallback(chatId, data) {

  // Reiniciamos el temporizador de inactividad, igual que en los mensajes de texto.
  gestionarTimeout(chatId);

  const estadoActual = estadosUsuarios[chatId];

  // ==============================================================
  // CALLBACK A: El usuario eligió un TRÁMITE desde el Inline Keyboard
  // ==============================================================
  if (estadoActual === 'ESPERANDO_TRAMITE' && data.startsWith('tramite_')) {

    // Extraemos el índice del callback_data (ej: "tramite_1" → "1").
    // parseInt() convierte ese string a número entero; el segundo argumento
    // (10) indica base decimal para evitar interpretaciones incorrectas.
    const indice = parseInt(data.replace('tramite_', ''), 10);

    // Verificamos que el índice sea un número válido y que exista en el array.
    // isNaN() devuelve true si parseInt() no pudo convertir el string a número.
    if (isNaN(indice) || !TRAMITES[indice]) {
      enviarMensaje(chatId, '⚠️ Ocurrió un error al procesar tu selección. Por favor, intentá de nuevo.');
      return;
    }

    // Guardamos el nombre del trámite (no el índice) en el registro temporal.
    // El resto del flujo siempre trabaja con el texto legible, no con números.
    registrosEnProceso[chatId].tramite = TRAMITES[indice];
    estadosUsuarios[chatId] = 'ESPERANDO_DIA';

    // Mostramos el selector de semanas como lista de WhatsApp.
    const semanasT = await proximasSemanas(30);
    enviarLista(
      chatId,
      `📋 Trámite elegido: ${TRAMITES[indice]}\n\n📅 Ahora elegí una semana:`,
      opcionesSemanas(semanasT)
    );
    return;
  }

  // ==============================================================
  // CALLBACK A1b: El vecino canceló la selección de trámite
  // ==============================================================
  if (estadoActual === 'ESPERANDO_TRAMITE' && data === 'cancelar_tramite') {

    const dniCancelar = registrosEnProceso[chatId]?.dni;

    // Si por alguna razón no hay DNI en memoria, tratamos al usuario como nuevo.
    if (!dniCancelar) {
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      enviarMensaje(
        chatId,
        'No hay problema. Si en algún momento querés sacar un turno, escribí *Menu* y arrancamos de nuevo.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let citasCancelar;
    try {
      citasCancelar = await ea.obtenerCitasDelCliente(`dni_${dniCancelar}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al consultar citas al cancelar trámite (DNI ${dniCancelar}):`, error.message);
      enviarMensaje(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    // Filtramos los turnos pasados: solo cuentan los que todavía no ocurrieron
    // para decidir si el vecino tiene turnos activos y para armar la lista del menú.
    const citasFuturasA1b = (citasCancelar.citas || []).filter(esCitaFutura);

    if (citasFuturasA1b.length > 0) {

      // El vecino ya tiene turnos futuros activos → lo devolvemos al menú de gestión.
      const nombreC   = citasCancelar.nombreCliente || registrosEnProceso[chatId].nombre || 'vecino/a';
      const renglones = citasFuturasA1b.map((cita, i) => {
        const servicio      = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
        const tramiteNombre = servicio ? servicio.name : `Servicio ${cita.serviceId}`;
        const fechaTexto    = formatearFechaTexto(new Date(`${cita.start.substring(0, 10)}T12:00:00`));
        const horario       = cita.start.substring(11, 16);
        return `  *${i + 1}.* ${tramiteNombre} — ${fechaTexto} a las ${horario} hs`;
      });

      registrosEnProceso[chatId].nombre = nombreC;
      estadosUsuarios[chatId] = 'MENU_GESTION';

      enviarMenuGestion(
        chatId,
        `👋 Hola ${nombreC}, estos son tus turnos activos:\n\n` +
        renglones.join('\n') + '\n\n¿Qué querés hacer?',
        true
      );
    } else {
      // Sin turnos futuros → vecino sin reservas vigentes; despedida amigable.
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      enviarMensaje(
        chatId,
        'No hay problema. Si en algún momento querés sacar un turno, escribí *Menu* y arrancamos de nuevo.',
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  // ==============================================================
  // CALLBACK A2: El usuario eligió una SEMANA → mostramos los días hábiles
  // ==============================================================
  if (estadoActual === 'ESPERANDO_DIA' && data.startsWith('semana_')) {

    // callback_data: "semana_2026-04-07_2026-04-11"
    // Las fechas ISO solo tienen guiones, así que el único guión bajo es el separador.
    const [fechaInicio, fechaFin] = data.replace('semana_', '').split('_');

    // Recorremos el rango día a día y nos quedamos solo con los días hábiles.
    const diasDeSemana = [];
    const cursor = new Date(`${fechaInicio}T12:00:00`);
    const finSemana = new Date(`${fechaFin}T12:00:00`);
    while (cursor <= finSemana) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) diasDeSemana.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    // Construimos las opciones de días hábiles para la lista de WhatsApp.
    const opcionesDias = diasDeSemana.map((dia) => ({
      id:     `fecha_${formatearFechaClave(dia)}`,
      titulo: formatearFechaTexto(dia),
    }));
    // Título acortado para respetar el límite de 24 caracteres de las filas de lista de WhatsApp.
    opcionesDias.push({ id: 'volver_semanas', titulo: '↩️ Volver' });

    estadosUsuarios[chatId] = 'ESPERANDO_FECHA';

    enviarLista(chatId, '📅 Ahora elegí el día:', opcionesDias);
    return;
  }

  // ==============================================================
  // CALLBACK A2b: El vecino quiere volver al selector de trámite
  // ==============================================================
  if (estadoActual === 'ESPERANDO_DIA' && data === 'volver_tramites') {

    const dniVT = registrosEnProceso[chatId]?.dni;

    let citasVT;
    try {
      citasVT = await ea.obtenerCitasDelCliente(`dni_${dniVT}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al consultar citas al volver a trámite (DNI ${dniVT}):`, error.message);
      enviarMensaje(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    // Solo bloqueamos trámites que tienen turnos futuros: si el único turno de
    // un trámite ya pasó, el vecino debería poder reservar uno nuevo.
    const tramitesActivos = new Set();
    (citasVT.citas || []).filter(esCitaFutura).forEach((cita) => {
      const servicio = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
      if (servicio) tramitesActivos.add(servicio.name);
    });

    const indicesDisponibles = TRAMITES
      .map((nombre, i) => ({ nombre, i }))
      .filter(({ nombre }) => !tramitesActivos.has(nombre))
      .map(({ i }) => i);

    if (indicesDisponibles.length === 0) {
      enviarMensaje(chatId, '⚠️ Ya tenés turnos activos para todos los trámites disponibles.');
      return;
    }

    delete registrosEnProceso[chatId].tramite;
    estadosUsuarios[chatId] = 'ESPERANDO_TRAMITE';

    // Pie recordatorio: el vecino puede escribir "Cancelar" para salir sin elegir.
    enviarLista(chatId, '📋 ¿Qué trámite querés realizar?\n\nSi no querés continuar, escribí *Cancelar*.', opcionesTramites(indicesDisponibles));
    return;
  }

  // ==============================================================
  // CALLBACK A3: El usuario quiere volver al selector de semanas
  // ==============================================================
  if (estadoActual === 'ESPERANDO_FECHA' && data === 'volver_semanas') {

    estadosUsuarios[chatId] = 'ESPERANDO_DIA';

    const semanasVolver = await proximasSemanas(30);
    enviarLista(chatId, '📅 Elegí una semana:', opcionesSemanas(semanasVolver));
    return;
  }

  // ==============================================================
  // CALLBACK B: El usuario eligió una FECHA
  // ==============================================================
  if (estadoActual === 'ESPERANDO_FECHA' && data.startsWith('fecha_')) {

    // Extraemos la clave de fecha del callback_data (ej: "fecha_2026-03-17" → "2026-03-17")
    const fechaClave = data.replace('fecha_', '');

    // Convertimos la clave a texto legible usando el mismo formato con el que
    // guardamos los turnos en el JSON, para que la comparación posterior sea exacta.
    const fechaObj = new Date(`${fechaClave}T12:00:00`); // Mediodía evita desfases de zona horaria
    const fechaTexto = formatearFechaTexto(fechaObj);

    // Recuperamos el trámite y el DNI del usuario actual desde la memoria temporal.
    // El trámite lo usamos para la condición global; el DNI para la condición personal.
    const tramiteElegido = registrosEnProceso[chatId].tramite;
    const dniActual      = registrosEnProceso[chatId].dni;

 // --- CONSULTA DE DISPONIBILIDAD EN EASY!APPOINTMENTS ---

    // Buscamos el objeto completo del trámite en TRAMITES_COMPLETOS
    // para obtener su ID numérico, que es lo que necesita la API.
    const servicioElegido = TRAMITES_COMPLETOS.find((s) => s.name === tramiteElegido);

    // Si no encontramos el servicio, algo falló al cargar los trámites.
    // Recargamos y pedimos al usuario que intente de nuevo.
    if (!servicioElegido) {
      await cargarTramites();
      enviarMensaje(
        chatId,
        '⚠️ Hubo un problema al identificar el trámite. Por favor, escribí /start para intentar de nuevo.'
      );
      estadosUsuarios[chatId] = 'INICIAL';
      delete registrosEnProceso[chatId];
      return;
    }

    // Consultamos a Easy!Appointments qué horarios libres hay para este
    // servicio en la fecha elegida, considerando todos los operadores.
    // La función devuelve: { horariosLibres: [...], mapaHorarioOperador: {...} }
    const disponibilidad = await ea.obtenerDisponibilidadServicio(
      servicioElegido.id,
      fechaClave
    );

    let   horariosLibres      = disponibilidad.horariosLibres;
    const mapaHorarioOperador = disponibilidad.mapaHorarioOperador;

    // Guardamos el mapa en memoria temporal para usarlo en CALLBACK C
    // al momento de confirmar la reserva con el operador correcto.
    registrosEnProceso[chatId].mapaHorarioOperador = mapaHorarioOperador;
    registrosEnProceso[chatId].serviceId           = servicioElegido.id;

    // Filtramos los horarios que el vecino ya tiene ocupados en esa fecha,
    // incluyendo cualquier slot que caiga dentro de la duración de una cita existente.
    try {
      const emailFicticio = `dni_${dniActual}@municipio.local`;
      const { citas: citasVecino } = await ea.obtenerCitasDelCliente(emailFicticio);

      // Convierte "HH:MM" a minutos totales desde medianoche para poder
      // comparar rangos numéricos en lugar de strings de hora.
      const toMinutos = (hhmm) => {
        const [h, m] = hhmm.split(':').map(Number);
        return h * 60 + m;
      };

      // Para cada cita del vecino en la fecha elegida, calculamos el rango
      // [inicioOcupado, finOcupado) en minutos y descartamos todo slot que caiga dentro.
      const citasEnFecha = citasVecino.filter((cita) => cita.start && cita.start.startsWith(fechaClave));

      if (citasEnFecha.length > 0) {
        const rangosOcupados = citasEnFecha.map((cita) => {
          const horaInicio   = cita.start.substring(11, 16); // "HH:MM"
          const inicioMin    = toMinutos(horaInicio);
          const duracion     = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId)?.duration ?? 30;
          return { inicio: inicioMin, fin: inicioMin + duracion };
        });

        horariosLibres = horariosLibres.filter((slot) => {
          const slotMin = toMinutos(slot);
          return !rangosOcupados.some((r) => slotMin >= r.inicio && slotMin < r.fin);
        });
      }
    } catch (errCitas) {
      // Si la consulta de citas propias falla, continuamos con todos los horarios
      // de EA sin filtrar: es mejor ofrecer un horario potencialmente solapado
      // que dejar al vecino sin opciones por un error secundario.
      logger.error('⚠️ No se pudieron obtener las citas del vecino para filtrar solapamientos:', errCitas.message);
    }

    // Si el array quedó vacío, ningún horario está disponible para esa fecha y trámite.
    if (horariosLibres.length === 0) {

      // Volvemos al selector de semanas para que el vecino elija otra fecha.
      estadosUsuarios[chatId] = 'ESPERANDO_DIA';

      const semanasNoSlots = await proximasSemanas(30);
      enviarLista(
        chatId,
        `⚠️ No hay horarios disponibles para ${fechaTexto} ` +
        `en el trámite de ${tramiteElegido}.\n\nPor favor, elegí otra semana:`,
        opcionesSemanas(semanasNoSlots)
      );
      return;
    }

    // Si llegamos acá, hay al menos un horario libre.
    // Guardamos la fecha en el registro temporal y avanzamos de estado.
    registrosEnProceso[chatId].fecha = fechaClave;
    estadosUsuarios[chatId] = 'ESPERANDO_HORARIO';

    // Guardamos TODOS los horarios disponibles y la página actual (0 = primera).
    // Esto permite la navegación bidireccional cuando hay más de 8 horarios en el día.
    registrosEnProceso[chatId].todosLosHorarios = horariosLibres;
    registrosEnProceso[chatId].paginaHorarios   = 0;

    // WhatsApp permite máximo 10 filas por lista.
    // Con 8 horarios por página quedan 2 filas libres para los botones de navegación.
    const HORARIOS_POR_PAGINA = 8;
    const fin0          = HORARIOS_POR_PAGINA;
    // ¿Hay más horarios a partir de la página 2?
    const haySiguiente0 = horariosLibres.length > fin0;

    // Construimos las filas de horarios de la primera página.
    const opcionesHorarios = horariosLibres.slice(0, fin0).map((h) => ({
      id:     `horario_${h}`,
      titulo: `🕐 ${h}`,
    }));

    // En la primera página nunca hay botón "Anterior".
    // Si hay más horarios adelante, mostramos "Ver más" apuntando a la página 1.
    if (haySiguiente0) {
      opcionesHorarios.push({ id: 'mas_horarios_1', titulo: '➡️ Ver más' });
    }

    // "↩️ Volver" aparece siempre en la primera página (y en la última).
    // En páginas intermedias no se muestra: el vecino usa "⬅️ Anterior" para retroceder.
    opcionesHorarios.push({ id: 'volver_fechas', titulo: '↩️ Volver' });

    enviarLista(
      chatId,
      `📅 Fecha elegida: ${fechaTexto}\n\n🕐 Ahora elegí un horario:`,
      opcionesHorarios
    );
    return;
  }

  // ==============================================================
  // CALLBACK C: El usuario eligió un HORARIO → mostramos resumen para confirmar
  // ==============================================================
  if (estadoActual === 'ESPERANDO_HORARIO' && data.startsWith('horario_')) {

    const horarioElegido = data.replace('horario_', ''); // ej: "10:00"

    const { dni, nombre, tramite, fecha, serviceId, mapaHorarioOperador } = registrosEnProceso[chatId];

    const fechaObj   = new Date(`${fecha}T12:00:00`);
    const fechaTexto = formatearFechaTexto(fechaObj);

    const providerId = mapaHorarioOperador[horarioElegido];

    const servicioActual = TRAMITES_COMPLETOS.find((s) => s.id === serviceId);
    const duracion       = servicioActual ? servicioActual.duration : 30;

    const [hora, minuto] = horarioElegido.split(':').map(Number);
    const minutosFinales = minuto + duracion;
    const horaFin        = hora + Math.floor(minutosFinales / 60);
    const minutoFin      = minutosFinales % 60;
    const pad            = (n) => String(n).padStart(2, '0');
    const fechaHora      = `${fecha} ${pad(hora)}:${pad(minuto)}:00`;
    const fechaHoraFin   = `${fecha} ${pad(horaFin)}:${pad(minutoFin)}:00`;

    // Guardamos los datos calculados para que CALLBACK C2 los use al confirmar.
    registrosEnProceso[chatId].horario      = horarioElegido;
    registrosEnProceso[chatId].providerId   = providerId;
    registrosEnProceso[chatId].fechaHora    = fechaHora;
    registrosEnProceso[chatId].fechaHoraFin = fechaHoraFin;

    estadosUsuarios[chatId] = 'ESPERANDO_CONFIRMACION';

    // Usamos botones de respuesta rápida para la confirmación (Sí/No).
    enviarBotones(
      chatId,
      `¿Confirmás el siguiente turno?\n\n` +
      `👤 Nombre: ${nombre}\n` +
      `🪪 DNI: ${dni}\n` +
      `📋 Trámite: ${tramite}\n` +
      `📅 Fecha: ${fechaTexto}\n` +
      `🕐 Horario: ${horarioElegido} hs`,
      [
        { id: 'confirmar_turno',       titulo: '✅ Confirmar' },
        { id: 'cancelar_confirmacion', titulo: '❌ Cancelar'  },
      ]
    );
    return;
  }

  // ==============================================================
  // CALLBACK C2: El vecino confirmó el turno → creamos la cita en EA
  // ==============================================================
  if (estadoActual === 'ESPERANDO_CONFIRMACION' && data === 'confirmar_turno') {

    const { dni, nombre, tramite, fecha, serviceId,
            horario: horarioElegido, providerId,
            fechaHora, fechaHoraFin } = registrosEnProceso[chatId];

    const fechaTexto     = formatearFechaTexto(new Date(`${fecha}T12:00:00`));
    const esModificacion = registrosEnProceso[chatId].esModificacion === true;

    logger.info('📤 Datos enviados a EA:', JSON.stringify({
      serviceId, providerId, nombre, dni,
      email: `dni_${dni}@municipio.local`,
      fechaHora, fechaHoraFin,
    }));

    try {
      const citaCreada = await ea.crearCita({
        serviceId,
        providerId,
        nombre,
        apellido:    '',
        dni,
        email:       `dni_${dni}@municipio.local`,
        fechaHora,
        fechaHoraFin,
        notas:       `DNI: ${dni} | Trámite: ${tramite}`,
      });
      logger.info('📥 Respuesta de EA:', JSON.stringify(citaCreada));
    } catch (error) {
      logger.error(`❌ Error al crear cita en EA para DNI ${dni}:`, error.message);
      enviarMensaje(
        chatId,
        '⚠️ Hubo un problema al confirmar tu turno. Es posible que ese horario haya sido tomado en este momento.\n\n' +
        'Escribí *Menu* para volver al inicio y elegir otro horario.',
        { parse_mode: 'Markdown' }
      );
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      gestionarTimeout(chatId);
      return;
    }

    logger.info(`💾 Turno registrado en EA: ${nombre} (DNI: ${dni}) → ${tramite} | ${fechaTexto} ${horarioElegido}`);

    const encabezadoConfirmacion = esModificacion
      ? '✏️ *¡Tu turno fue modificado correctamente!*'
      : '✅ *¡Tu turno quedó confirmado!*';

    const pieConfirmacion = esModificacion
      ? 'Te esperamos. ¡Hasta pronto!'
      : 'Tu turno quedó registrado en el sistema. Te esperamos. ¡Hasta pronto!';

    enviarMensaje(
      chatId,
      `${encabezadoConfirmacion}\n\n` +
      `👤 *Nombre:* ${nombre}\n` +
      `🪪 *DNI:* ${dni}\n` +
      `📋 *Trámite:* ${tramite}\n` +
      `📅 *Fecha:* ${fechaTexto}\n` +
      `🕐 *Horario:* ${horarioElegido} hs\n\n` +
      pieConfirmacion,
      { parse_mode: 'Markdown' }
    );

    delete registrosEnProceso[chatId];
    estadosUsuarios[chatId] = 'INICIAL';
    gestionarTimeout(chatId);
    return;
  }

  // ==============================================================
  // CALLBACK C3: El vecino canceló la confirmación → volver al selector de semanas
  // ==============================================================
  if (estadoActual === 'ESPERANDO_CONFIRMACION' && data === 'cancelar_confirmacion') {

    // Eliminamos los datos del horario calculado pero conservamos el contexto
    // del trámite y del vecino para que pueda elegir otro día sin empezar de cero.
    delete registrosEnProceso[chatId].horario;
    delete registrosEnProceso[chatId].providerId;
    delete registrosEnProceso[chatId].fechaHora;
    delete registrosEnProceso[chatId].fechaHoraFin;
    delete registrosEnProceso[chatId].fecha;

    estadosUsuarios[chatId] = 'ESPERANDO_DIA';

    const semanasC3 = await proximasSemanas(30);
    enviarLista(chatId, '📅 Entendido. Elegí una nueva semana para tu turno:', opcionesSemanas(semanasC3));
    return;
  }

  // ==============================================================
  // CALLBACK D: El usuario quiere volver a elegir la FECHA
  // ==============================================================
  if (estadoActual === 'ESPERANDO_HORARIO' && data === 'volver_fechas') {

    // Eliminamos la fecha guardada provisionalmente en el registro temporal.
    // Si no la borramos y el usuario elige una fecha diferente, el dato viejo
    // podría quedar huérfano y causar inconsistencias en pasos posteriores.
    delete registrosEnProceso[chatId].fecha;

    // Retrocedemos al selector de semanas; el trámite y el nombre siguen guardados.
    estadosUsuarios[chatId] = 'ESPERANDO_DIA';

    const semanasD = await proximasSemanas(30);
    enviarLista(chatId, '📅 Elegí una semana para tu turno:', opcionesSemanas(semanasD));
    return;
  }

  // ==============================================================
  // CALLBACK E0: El usuario eligió "Finalizar" desde el menú de gestión
  // ==============================================================
  if (estadoActual === 'MENU_GESTION' && data === 'finalizar_sesion') {

    delete registrosEnProceso[chatId];
    estadosUsuarios[chatId] = 'INICIAL';
    gestionarTimeout(chatId);

    enviarMensaje(
      chatId,
      '¡Hasta luego! Si necesitás algo más, escribí *Menu* cuando quieras.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ==============================================================
  // CALLBACK E: El usuario eligió "Nuevo Trámite" desde el menú de gestión
  // ==============================================================
  if (estadoActual === 'MENU_GESTION' && data === 'nuevo_tramite') {

    const dniEnProceso = registrosEnProceso[chatId].dni;

    // Consultamos EA para saber qué trámites ya tiene reservados este vecino.
    // No podemos confiar en el JSON porque las citas ahora viven en EA.
    let citasActivasE;
    try {
      citasActivasE = await ea.obtenerCitasDelCliente(`dni_${dniEnProceso}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al obtener citas para nuevo trámite (DNI ${dniEnProceso}):`, error.message);
      enviarMensaje(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    // Construimos un Set con los nombres de los trámites que el vecino ya tiene activos.
    // Usamos Set porque has() es más eficiente que includes() para búsquedas repetidas.
    // Convertimos serviceId → nombre usando TRAMITES_COMPLETOS para poder comparar
    // contra el array TRAMITES[], que trabaja con nombres (no con IDs numéricos).
    // Solo bloqueamos los trámites con turnos futuros: si el turno ya pasó,
    // el vecino puede volver a reservar ese trámite sin problema.
    const tramitesActivos = new Set();
    (citasActivasE.citas || []).filter(esCitaFutura).forEach((cita) => {
      const servicio = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
      if (servicio) tramitesActivos.add(servicio.name);
    });

    // Filtramos los índices de TRAMITES conservando solo los que el usuario
    // todavía NO tiene activos. El proceso tiene tres pasos encadenados:
    //   1. map()    → asociamos cada trámite con su índice original { nombre, i }
    //   2. filter() → descartamos los trámites cuyo nombre esté en tramitesActivos
    //   3. map()    → nos quedamos únicamente con el número de índice
    // Preservar el índice original es obligatorio porque callback_data lo usa.
    const indicesDisponibles = TRAMITES
      .map((nombre, i) => ({ nombre, i }))
      .filter(({ nombre }) => !tramitesActivos.has(nombre))
      .map(({ i }) => i);

    // Si el array quedó vacío, el usuario ya cubrió todos los trámites disponibles.
    // NO cambiamos el estado ni mostramos botones: solo enviamos el aviso informativo
    // y lo dejamos en MENU_GESTION para que pueda elegir otra acción.
    if (indicesDisponibles.length === 0) {
      enviarMensaje(
        chatId,
        '⚠️ Ya tenés turnos activos para todos los trámites disponibles.'
      );
      return;
    }

    // Hay al menos un trámite libre: avanzamos el estado a ESPERANDO_TRAMITE
    // y le mostramos solo los botones de los trámites que todavía puede reservar.
    estadosUsuarios[chatId] = 'ESPERANDO_TRAMITE';

    // Pie recordatorio: el vecino puede escribir "Cancelar" para salir sin elegir.
    enviarLista(chatId, '📋 ¿Qué trámite querés agregar?\n\nSi no querés continuar, escribí *Cancelar*.', opcionesTramites(indicesDisponibles));
    return;
  }

  // ==============================================================
  // CALLBACK F: El usuario eligió "Modificar Turno" desde el menú de gestión
  // ==============================================================
  if (estadoActual === 'MENU_GESTION' && data === 'modificar_turno') {

    // Cambiamos el estado para identificar que los próximos callbacks de este
    // usuario corresponden a la selección de qué turno quiere modificar.
    estadosUsuarios[chatId] = 'ESPERANDO_MODIFICACION';

    const dniModificacion = registrosEnProceso[chatId].dni;

    // Consultamos EA para obtener las citas actuales del vecino.
    let citasModificacion;
    try {
      citasModificacion = await ea.obtenerCitasDelCliente(`dni_${dniModificacion}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al obtener citas para modificar (DNI ${dniModificacion}):`, error.message);
      estadosUsuarios[chatId] = 'MENU_GESTION';
      enviarMensaje(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    // Filtramos los turnos pasados: no tiene sentido modificar un turno que ya ocurrió.
    const citasFuturasMod = (citasModificacion?.citas || []).filter(esCitaFutura);

    // Si no quedan citas futuras, no hay nada que modificar.
    if (citasFuturasMod.length === 0) {

      estadosUsuarios[chatId] = 'MENU_GESTION';
      enviarMensaje(chatId, '⚠️ No tenés turnos activos para modificar.');
      return;
    }

    // Guardamos solo las citas futuras en memoria temporal para que CALLBACK F2
    // pueda identificar la cita elegida por su ID sin re-consultar EA.
    registrosEnProceso[chatId].citasModificacion = citasFuturasMod;

    // Construimos las opciones para la lista de WhatsApp con los turnos a editar.
    // Usamos cita.id (ID real de EA) como identificador de cada opción.
    // formatearTituloTurno() garantiza que el título no supere los 24 caracteres
    // del límite de WhatsApp, truncando el nombre del trámite si fuera necesario.
    const opcionesEditar = citasFuturasMod.map((cita) => {
      const servicio      = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
      const tramiteNombre = servicio ? servicio.name : `Servicio ${cita.serviceId}`;
      const fechaCorta    = formatearFechaCorta(new Date(`${cita.start.substring(0, 10)}T12:00:00`));
      const horario       = cita.start.substring(11, 16);
      return { id: `editar_${cita.id}`, titulo: formatearTituloTurno(tramiteNombre, fechaCorta, horario) };
    });
    // Título acortado para respetar el límite de 24 caracteres de las filas de lista de WhatsApp.
    opcionesEditar.push({ id: 'volver_menu_gestion', titulo: '↩️ Volver' });

    enviarLista(chatId, '¿Qué turno necesitás modificar?', opcionesEditar);
    return;
  }

  // ==============================================================
  // CALLBACK F2: El usuario eligió qué turno editar (botón "editar_N")
  // ==============================================================
  if (estadoActual === 'ESPERANDO_MODIFICACION' && data.startsWith('editar_')) {

    // Extraemos el ID de la cita en EA desde el callback_data (ej: "editar_47" → 47).
    // Este ID fue puesto por CALLBACK F al armar los botones; no es un índice de array
    // sino el identificador real que necesita cancelarCita() para liberar el cupo.
    const appointmentId = parseInt(data.replace('editar_', ''), 10);

    if (isNaN(appointmentId)) {
      enviarMensaje(chatId, '⚠️ Ocurrió un error al procesar la selección. Intentá de nuevo.');
      return;
    }

    // Buscamos la cita en la lista que CALLBACK F guardó en memoria temporal.
    const citasModificacion = registrosEnProceso[chatId].citasModificacion || [];
    const citaAEditar       = citasModificacion.find((c) => c.id === appointmentId);

    // Si no se encuentra (botón desactualizado, sesión renovada, etc.), abortamos.
    if (!citaAEditar) {
      enviarMensaje(chatId, '⚠️ Ese turno ya no existe o la sesión expiró. Ingresá tu DNI para volver al menú.');
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      return;
    }

    // Obtenemos el nombre del trámite a partir del serviceId de la cita.
    // Lo guardamos en registrosEnProceso para que el flujo de fecha/horario
    // sepa qué servicio está en proceso, igual que en el flujo de turno nuevo.
    const servicio      = TRAMITES_COMPLETOS.find((s) => s.id === citaAEditar.serviceId);
    const tramiteAEditar = servicio ? servicio.name : `Servicio ${citaAEditar.serviceId}`;
    registrosEnProceso[chatId].tramite = tramiteAEditar;

    // Bandera que le indica a CALLBACK C que este flujo es una modificación
    // y no un turno nuevo; diferencia el mensaje de confirmación final.
    registrosEnProceso[chatId].esModificacion = true;

    const dniEditar = registrosEnProceso[chatId].dni;

    // LIBERACIÓN DEL CUPO: cancelamos la cita vieja en EA ANTES de pedir la nueva fecha.
    // Si no lo hacemos primero, el cupo que ocupa esta cita aparecería como "tomado"
    // al consultar disponibilidad, impidiéndole al vecino reservar el mismo horario.
    try {
      await ea.cancelarCita(appointmentId);
    } catch (error) {
      logger.error(`❌ Error al liberar cita ${appointmentId} para modificar (DNI ${dniEditar}):`, error.message);
      enviarMensaje(
        chatId,
        '⚠️ No pudimos liberar tu turno anterior. Por favor, intentá de nuevo.'
      );
      return;
    }

    logger.info(`✏️  Turno a modificar liberado en EA: DNI ${dniEditar} → cita ${appointmentId} (${tramiteAEditar})`);

    // Avanzamos al selector de semanas: el flujo de fecha y horario es el mismo
    // que cuando se saca un turno nuevo; no hace falta duplicar esa lógica.
    estadosUsuarios[chatId] = 'ESPERANDO_DIA';

    const semanasE = await proximasSemanas(30);
    enviarLista(
      chatId,
      `Turno anterior liberado. 📅 Elegí la nueva semana para tu trámite de ${tramiteAEditar}:`,
      opcionesSemanas(semanasE)
    );
    return;
  }

  // ==============================================================
  // CALLBACK F3: El usuario se arrepintió desde la pantalla de modificación
  // ==============================================================
  if (data === 'volver_menu_gestion') {

    const dniVolver = registrosEnProceso[chatId]?.dni;

    if (!dniVolver) {
      estadosUsuarios[chatId] = 'ESPERANDO_DNI';
      enviarMensaje(chatId, 'La sesión expiró. Por favor, ingresá tu DNI para volver al menú.');
      return;
    }

    let citasVolver;
    try {
      citasVolver = await ea.obtenerCitasDelCliente(`dni_${dniVolver}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al consultar citas al volver al menú (DNI ${dniVolver}):`, error.message);
      enviarMensaje(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    const nombreVolver = citasVolver.nombreCliente || registrosEnProceso[chatId].nombre || 'vecino/a';
    // Filtramos turnos pasados: el menú solo debe reflejar turnos que aún no ocurrieron.
    const citasV = (citasVolver.citas ?? []).filter(esCitaFutura);

    const textoMenuV = citasV.length > 0
      ? `👋 Hola *${nombreVolver}*, estos son tus turnos activos:\n\n` +
        citasV.map((cita, i) => {
          const servicio      = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
          const tramiteNombre = servicio ? servicio.name : `Servicio ${cita.serviceId}`;
          const fechaTexto    = formatearFechaTexto(new Date(`${cita.start.substring(0, 10)}T12:00:00`));
          const horario       = cita.start.substring(11, 16);
          return `  *${i + 1}.* ${tramiteNombre} — ${fechaTexto} a las ${horario} hs`;
        }).join('\n') + '\n\n¿Qué querés hacer?'
      : `👋 Hola *${nombreVolver}*, no tenés turnos activos por el momento.\n\n¿Qué querés hacer?`;

    registrosEnProceso[chatId].nombre = nombreVolver;
    estadosUsuarios[chatId] = 'MENU_GESTION';

    enviarMenuGestion(chatId, textoMenuV, citasV.length > 0);
    return;
  }

  // ==============================================================
  // CALLBACK G: El usuario eligió "Cancelar Turno" desde el menú de gestión
  // ==============================================================
  if (estadoActual === 'MENU_GESTION' && data === 'cancelar_turno') {

    // Cambiamos el estado para que los próximos callbacks de este usuario
    // sean interpretados como una selección dentro del flujo de cancelación.
    estadosUsuarios[chatId] = 'ESPERANDO_CANCELACION';

    const dniCancelacion = registrosEnProceso[chatId].dni;

    // Consultamos EA para obtener las citas actuales del vecino.
    let citasCancelacion;
    try {
      citasCancelacion = await ea.obtenerCitasDelCliente(`dni_${dniCancelacion}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al obtener citas para cancelar (DNI ${dniCancelacion}):`, error.message);
      estadosUsuarios[chatId] = 'MENU_GESTION';
      enviarMensaje(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    // Filtramos los turnos pasados: no tiene sentido cancelar un turno que ya ocurrió.
    const citasFuturasCan = (citasCancelacion?.citas || []).filter(esCitaFutura);

    // Si no quedan citas futuras, no hay nada para cancelar.
    if (citasFuturasCan.length === 0) {
      estadosUsuarios[chatId] = 'MENU_GESTION';
      enviarMensaje(chatId, '⚠️ No tenés turnos activos para cancelar.');
      return;
    }

    // Guardamos solo las citas futuras en memoria temporal para que CALLBACK H
    // pueda leer los datos del turno (tramite, fecha, horario) sin re-consultar EA.
    // La clave es el ID de la cita en EA, que también viaja en el callback_data del botón.
    registrosEnProceso[chatId].citasCancelacion = citasFuturasCan;

    // Construimos las opciones para la lista de WhatsApp con los turnos a cancelar.
    // Usamos cita.id (ID real de EA) como identificador de cada opción.
    // formatearTituloTurno() garantiza que el título no supere los 24 caracteres
    // del límite de WhatsApp, truncando el nombre del trámite si fuera necesario.
    const opcionesTurnos = citasFuturasCan.map((cita) => {
      const servicio      = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
      const tramiteNombre = servicio ? servicio.name : `Servicio ${cita.serviceId}`;
      const fechaCorta    = formatearFechaCorta(new Date(`${cita.start.substring(0, 10)}T12:00:00`));
      const horario       = cita.start.substring(11, 16);
      return { id: `borrar_${cita.id}`, titulo: formatearTituloTurno(tramiteNombre, fechaCorta, horario) };
    });
    // Título acortado para respetar el límite de 24 caracteres de las filas de lista de WhatsApp.
    opcionesTurnos.push({ id: 'volver_menu', titulo: '↩️ Volver' });

    enviarLista(chatId, 'Seleccioná el turno que deseás cancelar:', opcionesTurnos);
    return;
  }

  // ==============================================================
  // CALLBACK H: El usuario eligió qué turno borrar → mostramos resumen para confirmar
  // ==============================================================
  if (estadoActual === 'ESPERANDO_CANCELACION' && data.startsWith('borrar_')) {

    const appointmentId = parseInt(data.replace('borrar_', ''), 10);

    if (isNaN(appointmentId)) {
      enviarMensaje(chatId, '⚠️ Ocurrió un error al procesar la selección. Intentá de nuevo.');
      return;
    }

    const citasCancelacion = registrosEnProceso[chatId].citasCancelacion || [];
    const citaACancelar    = citasCancelacion.find((c) => c.id === appointmentId);

    if (!citaACancelar) {
      enviarMensaje(chatId, '⚠️ Ese turno ya no existe o la sesión expiró. Ingresá tu DNI para volver al menú.');
      delete registrosEnProceso[chatId];
      estadosUsuarios[chatId] = 'INICIAL';
      return;
    }

    const servicio         = TRAMITES_COMPLETOS.find((s) => s.id === citaACancelar.serviceId);
    const tramiteCancelado = servicio ? servicio.name : `Servicio ${citaACancelar.serviceId}`;
    const fechaCancelada   = formatearFechaTexto(new Date(`${citaACancelar.start.substring(0, 10)}T12:00:00`));
    const horarioCancelado = citaACancelar.start.substring(11, 16);
    const dniBorrar        = registrosEnProceso[chatId].dni;

    // Guardamos los datos de la cita a cancelar para que CALLBACK H2 los use al confirmar.
    registrosEnProceso[chatId].citaAConfirmarCancelacion = {
      appointmentId, tramiteCancelado, fechaCancelada, horarioCancelado, dniBorrar,
    };
    estadosUsuarios[chatId] = 'ESPERANDO_CONFIRMACION_CANCELACION';

    // Botones de respuesta rápida para confirmar o cancelar la cancelación.
    enviarBotones(
      chatId,
      `¿Confirmás la cancelación del siguiente turno?\n\n` +
      `📋 Trámite: ${tramiteCancelado}\n` +
      `📅 Fecha: ${fechaCancelada}\n` +
      `🕐 Horario: ${horarioCancelado} hs`,
      [
        // Límite de WhatsApp: 20 caracteres por título de botón.
        // '✅ Confirmar cancelación' tiene 21 → se acorta a '✅ Confirmar' (10 caracteres).
        { id: 'confirmar_cancelacion', titulo: '✅ Confirmar' },
        { id: 'volver_menu', titulo: '↩️ Volver' },
      ]
    );
    return;
  }

  // ==============================================================
  // CALLBACK H2: El vecino confirmó la cancelación → eliminamos la cita en EA
  // ==============================================================
  if (estadoActual === 'ESPERANDO_CONFIRMACION_CANCELACION' && data === 'confirmar_cancelacion') {

    const { appointmentId, tramiteCancelado, fechaCancelada, horarioCancelado, dniBorrar }
      = registrosEnProceso[chatId].citaAConfirmarCancelacion;

    try {
      await ea.cancelarCita(appointmentId);
    } catch (error) {
      logger.error(`❌ Error al cancelar cita ${appointmentId} para DNI ${dniBorrar}:`, error.message);
      enviarMensaje(
        chatId,
        '⚠️ No pudimos cancelar el turno en este momento. Por favor, intentá de nuevo.'
      );
      return;
    }

    logger.info(`🗑️  Turno cancelado en EA: DNI ${dniBorrar} → ${tramiteCancelado} | ${fechaCancelada} ${horarioCancelado}`);

    // Limpiamos el objeto de confirmación pero mantenemos el DNI para que
    // volver_menu_post_cancelacion pueda relanzar el menú sin pedirlo de nuevo.
    delete registrosEnProceso[chatId].citaAConfirmarCancelacion;
    estadosUsuarios[chatId] = 'INICIAL';

    // Un solo botón para volver al menú tras la cancelación exitosa.
    enviarBotones(
      chatId,
      `❌ Cancelaste exitosamente el turno de ${tramiteCancelado} ` +
      `del ${fechaCancelada} a las ${horarioCancelado} hs.\n\n` +
      `Si necesitás hacer algo más, tocá el botón de abajo.`,
      // Título acortado para respetar el límite de 20 caracteres de los botones de WhatsApp.
      [{ id: 'volver_menu_post_cancelacion', titulo: '↩️ Volver al menú' }]
    );
    return;
  }

  // ==============================================================
  // CALLBACK I: El usuario tocó "Volver al menú" tras cancelar un turno
  // ==============================================================
  if (data === 'volver_menu_post_cancelacion') {

    const dniPostCancel = registrosEnProceso[chatId]?.dni;

    // Si por alguna razón el DNI ya no está en memoria, pedimos que lo reingrese.
    if (!dniPostCancel) {
      estadosUsuarios[chatId] = 'ESPERANDO_DNI';
      enviarMensaje(chatId, 'La sesión expiró. Por favor, ingresá tu DNI para volver al menú.');
      return;
    }

    // Consultamos EA con el DNI que ya tenemos en memoria para mostrar la
    // lista de turnos actualizada (sin el turno recién cancelado).
    let citasPostCancel;
    try {
      citasPostCancel = await ea.obtenerCitasDelCliente(`dni_${dniPostCancel}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al consultar citas post-cancelación (DNI ${dniPostCancel}):`, error.message);
      enviarMensaje(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    const nombre = citasPostCancel.nombreCliente || registrosEnProceso[chatId].nombre || 'vecino/a';

    // Filtramos turnos pasados: mostramos solo los que todavía no ocurrieron.
    const citasFuturasPost = (citasPostCancel.citas || []).filter(esCitaFutura);

    let textoMenu;
    if (citasFuturasPost.length > 0) {

      const listaTurnos = citasFuturasPost.map((cita) => {
        const servicio     = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
        const tramiteNombre = servicio ? servicio.name : `Servicio ${cita.serviceId}`;
        const fechaISO     = cita.start.substring(0, 10);
        const fechaTexto   = formatearFechaTexto(new Date(`${fechaISO}T12:00:00`));
        const horario      = cita.start.substring(11, 16);
        return { tramiteNombre, fechaTexto, horario };
      });

      const renglonesTurnos = listaTurnos.map((t, i) =>
        `  *${i + 1}.* ${t.tramiteNombre} — ${t.fechaTexto} a las ${t.horario} hs`
      );

      textoMenu =
        `👋 Hola *${nombre}*, estos son tus turnos activos:\n\n` +
        renglonesTurnos.join('\n') +
        '\n\n¿Qué querés hacer?';

    } else {
      textoMenu =
        `👋 Hola *${nombre}*, no tenés turnos activos por el momento.\n\n¿Qué querés hacer?`;
    }

    // Actualizamos el nombre en memoria por si el vecino era nuevo y aún no lo teníamos.
    registrosEnProceso[chatId].nombre = nombre;
    estadosUsuarios[chatId] = 'MENU_GESTION';

    enviarMenuGestion(chatId, textoMenu, citasFuturasPost.length > 0);
    return;
  }

  // ==============================================================
  // CALLBACK J: El usuario tocó "Volver al menú" desde otra pantalla
  // ==============================================================
  if (data === 'volver_menu') {

    const dniMenu = registrosEnProceso[chatId]?.dni;

    if (!dniMenu) {
      estadosUsuarios[chatId] = 'ESPERANDO_DNI';
      enviarMensaje(chatId, 'La sesión expiró. Por favor, ingresá tu DNI para volver al menú.');
      return;
    }

    let citasMenu;
    try {
      citasMenu = await ea.obtenerCitasDelCliente(`dni_${dniMenu}@municipio.local`);
    } catch (error) {
      logger.error(`❌ Error al consultar citas al volver al menú (DNI ${dniMenu}):`, error.message);
      enviarMensaje(chatId, '⚠️ No pudimos consultar tus turnos en este momento. Intentá de nuevo.');
      return;
    }

    const nombreMenu = citasMenu.nombreCliente || registrosEnProceso[chatId].nombre || 'vecino/a';
    // Filtramos turnos pasados: el menú solo debe reflejar turnos que aún no ocurrieron.
    const citasM = (citasMenu.citas ?? []).filter(esCitaFutura);

    const textoMenuM = citasM.length > 0
      ? `👋 Hola *${nombreMenu}*, estos son tus turnos activos:\n\n` +
        citasM.map((cita, i) => {
          const servicio      = TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId);
          const tramiteNombre = servicio ? servicio.name : `Servicio ${cita.serviceId}`;
          const fechaTexto    = formatearFechaTexto(new Date(`${cita.start.substring(0, 10)}T12:00:00`));
          const horario       = cita.start.substring(11, 16);
          return `  *${i + 1}.* ${tramiteNombre} — ${fechaTexto} a las ${horario} hs`;
        }).join('\n') + '\n\n¿Qué querés hacer?'
      : `👋 Hola *${nombreMenu}*, no tenés turnos activos por el momento.\n\n¿Qué querés hacer?`;

    registrosEnProceso[chatId].nombre = nombreMenu;
    estadosUsuarios[chatId] = 'MENU_GESTION';

    enviarMenuGestion(chatId, textoMenuM, citasM.length > 0);
    return;
  }

  // ==============================================================
  // CALLBACK B2: Navegación entre páginas de horarios (anterior / siguiente)
  // ==============================================================
  // Maneja dos tipos de id, ambos con el número de página destino al final:
  //   "mas_horarios_N"      → el vecino avanzó a la página N
  //   "horarios_anterior_N" → el vecino retrocedió a la página N
  // La lógica de construcción de filas es idéntica en ambos casos.
  if (estadoActual === 'ESPERANDO_HORARIO' &&
      (data.startsWith('mas_horarios_') || data.startsWith('horarios_anterior_'))) {

    // Extraemos el número de página destino según el prefijo del id.
    const pagina = data.startsWith('mas_horarios_')
      ? parseInt(data.replace('mas_horarios_', ''), 10)
      : parseInt(data.replace('horarios_anterior_', ''), 10);

    // WhatsApp permite máximo 10 filas por lista.
    // Con 8 horarios por página quedan 2 filas para los botones de navegación.
    const HORARIOS_POR_PAGINA = 8;
    const inicio = pagina * HORARIOS_POR_PAGINA;
    const fin    = inicio + HORARIOS_POR_PAGINA;

    // Recuperamos todos los horarios guardados al inicio de CALLBACK B.
    const todosLosHorarios = registrosEnProceso[chatId].todosLosHorarios || [];
    const horariosPagina   = todosLosHorarios.slice(inicio, fin);

    // Calculamos si existe página anterior y/o página siguiente.
    const hayAnterior  = pagina > 0;
    const haySiguiente = fin < todosLosHorarios.length;

    // Actualizamos la página actual en memoria.
    registrosEnProceso[chatId].paginaHorarios = pagina;

    // Construimos las filas de horarios de esta página.
    const opcionesHorariosPag = horariosPagina.map((h) => ({
      id:     `horario_${h}`,
      titulo: `🕐 ${h}`,
    }));

    // Si no es la primera página, mostramos "Anterior" para que el vecino pueda retroceder.
    // El id lleva el número de la página anterior (pagina - 1).
    if (hayAnterior) {
      opcionesHorariosPag.push({ id: `horarios_anterior_${pagina - 1}`, titulo: '⬅️ Anterior' });
    }

    // Si hay más horarios adelante, mostramos "Ver más" con el número de la siguiente página.
    if (haySiguiente) {
      opcionesHorariosPag.push({ id: `mas_horarios_${pagina + 1}`, titulo: '➡️ Ver más' });
    }

    // "↩️ Volver" aparece solo en la primera página (sin anterior) o en la última (sin siguiente).
    // En páginas intermedias el vecino usa "⬅️ Anterior" para retroceder, por lo que
    // agregar "Volver" solo añadiría ruido y podría superar las 10 filas del límite de WhatsApp.
    if (!hayAnterior || !haySiguiente) {
      opcionesHorariosPag.push({ id: 'volver_fechas', titulo: '↩️ Volver' });
    }

    // Recuperamos la fecha guardada para mostrarla en el encabezado del mensaje.
    const fechaGuardada = registrosEnProceso[chatId].fecha;
    const fechaTextoPag = formatearFechaTexto(new Date(`${fechaGuardada}T12:00:00`));

    enviarLista(
      chatId,
      `📅 Fecha elegida: ${fechaTextoPag}\n\n🕐 Elegí un horario:`,
      opcionesHorariosPag
    );
    return;
  }

  // ==============================================================
  // CATCH-ALL: botón no reconocido por ningún bloque anterior
  // ==============================================================
  // Si el código llegó hasta acá sin hacer "return", significa que
  // el callback_data del botón presionado no coincidió con ninguna
  // de las condiciones definidas arriba.
  //
  // Esto ocurre habitualmente cuando:
  //   a) La sesión del usuario expiró (el bot se reinició, el estado
  //      se perdió de memoria) y los botones del mensaje anterior
  //      ya no tienen un flujo activo al que pertenecer.
  //   b) El vecino presionó un botón de un paso anterior del flujo
  //      (por ejemplo, un selector de semana que ya fue reemplazado
  //      por el de horarios) y ese callback_data ya no es válido
  //      en el estado actual.
  //
  // En lugar de ignorar silenciosamente el evento (lo que dejaría
  // al usuario confundido sin respuesta), le explicamos qué pasó
  // y le indicamos cómo volver a empezar.
  //
  // En WhatsApp no existe el concepto de "responder al callback" como en Telegram.
  // Llegamos acá porque el id de la opción elegida no coincidió con ninguna
  // condición del flujo. Enviamos un mensaje explicativo al vecino.
  logger.info(`⚠️ Callback no reconocido — chatId: ${chatId}, data: "${data}", estado: "${estadoActual}"`);

  enviarMensaje(
    chatId,
    '⚠️ Este botón ya no está disponible.\n\n' +
    'Es posible que tu sesión haya expirado o que sea de un paso anterior del flujo.\n\n' +
    'Escribí *Menu* para volver a empezar desde el principio.',
    { parse_mode: 'Markdown' }
  );
}

// ---------------------------------------------------------------
// 13. INICIAR EL SERVIDOR WEB
// ---------------------------------------------------------------
// Ponemos Express a escuchar en el puerto definido por la variable
// de entorno PORT, o en el 3000 si no está configurada.
// El puerto 3000 es útil para desarrollo local; en producción
// (Railway, Render, etc.) la plataforma asigna el puerto via PORT.
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`✅ Servidor iniciado en el puerto ${PORT}. Esperando mensajes de WhatsApp...`);
});
