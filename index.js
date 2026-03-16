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
const TelegramBot = require('node-telegram-bot-api');

// "fs" (File System) es un módulo nativo de Node.js (no necesita instalarse).
// Nos permite leer y escribir archivos en el disco, que es cómo lograremos
// la persistencia real de los datos.
const fs = require('fs');

// "path" es otro módulo nativo de Node.js que ayuda a construir rutas
// de archivos de forma segura, sin importar el sistema operativo
// (Windows usa "\", Linux/Mac usan "/").
const path = require('path');

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
  const contenido = fs.readFileSync(RUTA_DB, 'utf-8');
  // JSON.parse() convierte el texto JSON en un objeto JavaScript utilizable.
  return JSON.parse(contenido);
}

// guardarUsuarios(): Recibe el array completo de usuarios y lo
// sobreescribe en el archivo JSON del disco, haciendo los cambios permanentes.
function guardarUsuarios(arrayUsuarios) {
  // JSON.stringify() convierte el array JavaScript de vuelta a texto JSON.
  // El tercer argumento (2) agrega sangría de 2 espacios para que el archivo
  // sea legible si lo abrimos con un editor de texto.
  const contenidoJson = JSON.stringify(arrayUsuarios, null, 2);
  fs.writeFileSync(RUTA_DB, contenidoJson, 'utf-8');
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
// Objeto que mapea el número que el usuario elige (como string)
// al nombre real del trámite. Usamos string como clave ("1", "2", "3")
// porque msg.text siempre llega como string desde Telegram.
const TRAMITES = {
  '1': 'Licencia de conducir',
  '2': 'Tribunal de Faltas',
  '3': 'Rentas',
};

// Fecha simulada fija para asignar a los nuevos turnos.
// En una aplicación real esto vendría de un calendario de disponibilidad.
const FECHA_TURNO_SIMULADA = '20 de marzo a las 10:00 hs';

// ---------------------------------------------------------------
// 6. VALIDAR Y OBTENER EL TOKEN
// ---------------------------------------------------------------
const token = process.env.TELEGRAM_TOKEN;

if (!token) {
  console.error('❌ Error: No se encontró TELEGRAM_TOKEN en el archivo .env');
  process.exit(1);
}

// ---------------------------------------------------------------
// 7. CREAR LA INSTANCIA DEL BOT
// ---------------------------------------------------------------
const bot = new TelegramBot(token, { polling: true });

console.log('✅ Bot iniciado correctamente. Esperando mensajes...');

// ---------------------------------------------------------------
// 8. MEMORIA DE ESTADO DE LAS CONVERSACIONES
// ---------------------------------------------------------------
// Objeto que guarda el estado actual de cada usuario en la conversación.
//
// Estados posibles:
//   - 'INICIAL'           → El usuario no inició ningún flujo aún.
//   - 'ESPERANDO_DNI'     → Le pedimos el DNI, aguardamos su respuesta.
//   - 'ESPERANDO_NOMBRE'  → El DNI no existe; le pedimos nombre y apellido.
//   - 'ESPERANDO_TRAMITE' → Ya tenemos nombre; le pedimos elegir trámite.
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
// 10. FUNCIONES AUXILIARES DE LÓGICA
// ---------------------------------------------------------------

// Detecta si el texto es un saludo común.
function esSaludo(texto) {
  const saludos = ['hola', 'buenas', 'buen dia', 'buen día', 'buenos dias', 'buenos días'];
  const textoNormalizado = texto.toLowerCase().trim();
  return saludos.some((saludo) => textoNormalizado.includes(saludo));
}

// Valida que el DNI tenga entre 7 y 8 dígitos numéricos únicamente.
function esDniValido(texto) {
  return /^\d{7,8}$/.test(texto.trim());
}

// Devuelve el mensaje de bienvenida estándar que pide el DNI.
function mensajeBienvenida() {
  return (
    '¡Hola! Bienvenido al sistema de turnos de prueba.\n' +
    'Por favor, ingresá tu número de DNI (sin puntos ni espacios) para consultar tu estado.'
  );
}

// Devuelve el menú de trámites formateado como texto.
function mensajeMenuTramites(nombre) {
  return (
    `Gracias, ${nombre}. ¿Qué trámite deseás realizar?\n` +
    'Respondé con el número de la opción:\n\n' +
    '1. Licencia de conducir\n' +
    '2. Tribunal de Faltas\n' +
    '3. Rentas'
  );
}

// ---------------------------------------------------------------
// 11. MANEJADOR PRINCIPAL DE MENSAJES
// ---------------------------------------------------------------
// Toda la lógica conversacional vive en este único bloque.
// El evento 'message' se dispara con cada mensaje que llega al bot.
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const texto = msg.text;

  // Ignoramos mensajes sin texto (fotos, stickers, archivos, etc.)
  if (!texto) return;

  // Obtenemos el estado actual del usuario (INICIAL si es la primera vez)
  const estadoActual = estadosUsuarios[chatId] || 'INICIAL';

  console.log(`📩 ${msg.chat.first_name} (${chatId}) | Estado: ${estadoActual} | Texto: "${texto}"`);

  // ==============================================================
  // RAMA A: Comando /start o saludo en estado INICIAL
  // Ambos disparan el mismo flujo: pedir el DNI.
  // ==============================================================
  if (texto.startsWith('/start') || (estadoActual === 'INICIAL' && esSaludo(texto))) {
    estadosUsuarios[chatId] = 'ESPERANDO_DNI';
    bot.sendMessage(chatId, mensajeBienvenida());
    return;
  }

  // ==============================================================
  // RAMA B: El bot espera que el usuario ingrese su DNI
  // ==============================================================
  if (estadoActual === 'ESPERANDO_DNI') {

    // B1: Validación de formato
    if (!esDniValido(texto)) {
      bot.sendMessage(
        chatId,
        '⚠️ El DNI ingresado no es válido.\n' +
        'Debe tener entre 7 y 8 números, sin letras ni espacios.\n' +
        'Por favor, intentá de nuevo.'
      );
      return; // Mantenemos el estado ESPERANDO_DNI para reintento
    }

    const dniIngresado = texto.trim();
    const usuarioEncontrado = buscarUsuarioPorDni(dniIngresado);

    // B2a: El usuario existe y tiene turno → mostramos el turno y reiniciamos
    if (usuarioEncontrado && usuarioEncontrado.tieneTurno) {
      const { nombre, turno } = usuarioEncontrado;
      bot.sendMessage(
        chatId,
        `✅ Hola ${nombre}, tenés un turno asignado para el ${turno.fecha} ` +
        `para el trámite de ${turno.tramite}.`
      );
      estadosUsuarios[chatId] = 'INICIAL';
      return;
    }

    // B2b: El usuario existe pero no tiene turno → mismo mensaje informativo
    if (usuarioEncontrado && !usuarioEncontrado.tieneTurno) {
      bot.sendMessage(
        chatId,
        `📋 Hola ${usuarioEncontrado.nombre}, actualmente no registrás turnos pendientes.`
      );
      estadosUsuarios[chatId] = 'INICIAL';
      return;
    }

    // B2c: El DNI NO existe en la base de datos → iniciamos el registro
    // Guardamos el DNI en memoria temporal para usarlo al final del registro
    registrosEnProceso[chatId] = { dni: dniIngresado };
    estadosUsuarios[chatId] = 'ESPERANDO_NOMBRE';

    bot.sendMessage(
      chatId,
      'No encontramos registros para tu DNI. Vamos a registrarte.\n' +
      'Por favor, ingresá tu Nombre y Apellido:'
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

    bot.sendMessage(chatId, mensajeMenuTramites(nombreIngresado));
    return;
  }

  // ==============================================================
  // RAMA D: El bot espera que el usuario elija un trámite (1, 2 o 3)
  // ==============================================================
  if (estadoActual === 'ESPERANDO_TRAMITE') {

    const opcionElegida = texto.trim();

    // D1: Validamos que la opción sea 1, 2 o 3.
    // TRAMITES[opcionElegida] será undefined si la clave no existe en el objeto.
    if (!TRAMITES[opcionElegida]) {
      bot.sendMessage(
        chatId,
        '⚠️ Opción no válida. Por favor respondé solo con 1, 2 o 3.'
      );
      return; // Mantenemos el estado ESPERANDO_TRAMITE para reintento
    }

    // D2: Recuperamos los datos guardados durante el proceso de registro
    const { dni, nombre } = registrosEnProceso[chatId];
    const tramiteElegido = TRAMITES[opcionElegida];

    // D3: Construimos el objeto del nuevo usuario siguiendo la misma
    // estructura que tienen los usuarios ya existentes en el JSON.
    const nuevoUsuario = {
      dni: dni,
      nombre: nombre,
      tieneTurno: true,
      turno: {
        fecha: FECHA_TURNO_SIMULADA,
        tramite: tramiteElegido,
      },
    };

    // D4: Leemos el array actual de usuarios, agregamos el nuevo y guardamos
    const usuariosActuales = leerUsuarios();
    usuariosActuales.push(nuevoUsuario); // push() agrega el elemento al final del array
    guardarUsuarios(usuariosActuales);   // Sobreescribe el archivo JSON en disco

    console.log(`💾 Nuevo usuario registrado: ${nombre} (DNI: ${dni}) → Trámite: ${tramiteElegido}`);

    // D5: Confirmación final al usuario
    bot.sendMessage(
      chatId,
      `¡Listo! Tu turno para ${tramiteElegido} quedó registrado para el ${FECHA_TURNO_SIMULADA}.`
    );

    // D6: Limpiamos la memoria temporal y reiniciamos el estado
    delete registrosEnProceso[chatId]; // delete elimina la clave del objeto
    estadosUsuarios[chatId] = 'INICIAL';
    return;
  }

  // ==============================================================
  // RAMA E: Mensaje fuera de contexto (estado INICIAL, sin saludo)
  // ==============================================================
  bot.sendMessage(
    chatId,
    'No entendí ese mensaje. Escribí "hola" o usá el comando /start para comenzar.'
  );
});

// ---------------------------------------------------------------
// 12. MANEJO DE ERRORES DE POLLING
// ---------------------------------------------------------------
bot.on('polling_error', (error) => {
  console.error('❌ Error de conexión con Telegram:', error.message);
});
