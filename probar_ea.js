require('dotenv').config();
const ea = require('./ea');

async function probar() {
  console.log('--- Probando obtenerServicios() ---');
  const servicios = await ea.obtenerServicios();
  console.log(JSON.stringify(servicios, null, 2));

  console.log('\n--- Probando obtenerDisponibilidadServicio() ---');
  // Usamos el ID 2 (Nueva Licencia) y una fecha hábil próxima
  const disponibilidad = await ea.obtenerDisponibilidadServicio(2, '2026-03-30');
  console.log('Horarios libres:', disponibilidad.horariosLibres);
  console.log('Mapa horario → operador:', disponibilidad.mapaHorarioOperador);
}

probar().catch(console.error);