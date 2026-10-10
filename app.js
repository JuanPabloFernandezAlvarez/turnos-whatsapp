// 1. DATOS
// =====================================================
 
const CLAVE_GUARDADO = "turnos_v1";

let datos = {
  turnos: [],
  negocio: "",
  plantilla:
    "Hola {nombre}! Te recordamos tu turno {dia} a las {hora} en {negocio}. ¿Me confirmás? 🙌",
};
 
// Si no es null, estamos editando ese turno en vez de crear uno nuevo
let editandoId = null;
 
const $ = (id) => document.getElementById(id);
 
function cargar() {
  try {
    const guardado = localStorage.getItem(CLAVE_GUARDADO);
    if (guardado) datos = { ...datos, ...JSON.parse(guardado) };
  } catch (error) {
    console.log("No se pudo leer lo guardado", error);
  }
}
 
function guardar() {
  try {
    localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(datos));
  } catch (error) {
    console.log("No se pudo guardar", error);
  }
}
 
// =====================================================
// 2. AVISOS (TOAST)
// =====================================================
 
let temporizadorToast;
 
function mostrarToast(texto) {
  let toast = $("toast");
 
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
 
  toast.textContent = texto;
  toast.classList.add("visible");
 
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => toast.classList.remove("visible"), 2000);
}
 
// =====================================================
// 3. FECHAS
// =====================================================
 
function hoyISO() {
  const ahora = new Date();
  ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
  return ahora.toISOString().slice(0, 10);
}
 
function nombreDelDia(fechaISO) {
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  manana.setMinutes(manana.getMinutes() - manana.getTimezoneOffset());
  const mananaISO = manana.toISOString().slice(0, 10);
 
  if (fechaISO === hoyISO()) return "hoy";
  if (fechaISO === mananaISO) return "mañana";
 
  const [anio, mes, dia] = fechaISO.split("-");
  const fecha = new Date(anio, mes - 1, dia);
  return (
    "el " +
    fecha.toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
  );
}
 
// =====================================================
// 4. WHATSAPP (solo si el turno tiene teléfono)
// =====================================================
 
function formatearTelefono(telefono) {
  let numero = telefono.replace(/\D/g, "");
  if (numero.startsWith("54")) return numero;
  numero = numero.replace(/^0/, "");
  return "549" + numero;
}
 
function armarMensaje(turno) {
  return datos.plantilla
    .replace("{nombre}", turno.nombre)
    .replace("{dia}", nombreDelDia(turno.fecha))
    .replace("{hora}", turno.hora)
    .replace("{negocio}", datos.negocio || "nuestro local");
}
 
function enviarRecordatorio(id) {
  const turno = datos.turnos.find((t) => t.id === id);
  const link =
    "https://wa.me/" +
    formatearTelefono(turno.telefono) +
    "?text=" +
    encodeURIComponent(armarMensaje(turno));
  window.open(link, "_blank");
}
 
// =====================================================
// 5. ACCIONES SOBRE LOS TURNOS
// =====================================================
 
function limpiarFormulario() {
  $("nombre").value = "";
  $("hora").value = "";
  $("telefono").value = "";
  $("fecha").value = hoyISO();
  $("btn-agregar").innerHTML = '<i class="bi bi-plus-lg"></i>';
  editandoId = null;
  $("nombre").focus();
}
 
// Sirve para crear un turno nuevo y también para guardar una edición
function guardarTurno() {
  const nombre = $("nombre").value.trim();
  const hora = $("hora").value;
  const fecha = $("fecha").value || hoyISO();
  const telefono = $("telefono").value.trim();
 
  // Mínimo necesario: nombre y hora
  if (!nombre || !hora) {
    mostrarToast("Falta el nombre o la hora");
    return;
  }
 
  if (editandoId) {
    const turno = datos.turnos.find((t) => t.id === editandoId);
    Object.assign(turno, { nombre, hora, fecha, telefono });
    mostrarToast("Turno corregido");
  } else {
    datos.turnos.push({
      id: Date.now(),
      nombre,
      hora,
      fecha,
      telefono,
      estado: "pendiente",
    });
    mostrarToast("Turno agregado");
  }
 
  guardar();
  limpiarFormulario();
  dibujarLista();
}
 
// Carga los datos del turno en el formulario para corregirlos
function editarTurno(id) {
  const turno = datos.turnos.find((t) => t.id === id);
  editandoId = id;
 
  $("nombre").value = turno.nombre;
  $("hora").value = turno.hora;
  $("fecha").value = turno.fecha;
  $("telefono").value = turno.telefono;
  $("btn-agregar").innerHTML = '<i class="bi bi-check-lg"></i>';
 
  $("nombre").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
  mostrarToast("Corregí y tocá ✓");
}
 
function cambiarEstado(id, nuevoEstado) {
  const turno = datos.turnos.find((t) => t.id === id);
  turno.estado = nuevoEstado;
  guardar();
  dibujarLista();
  mostrarToast("Turno " + nuevoEstado);
}
 
function borrarTurno(id) {
  if (!confirm("¿Borrar turno?")) return;
  datos.turnos = datos.turnos.filter((t) => t.id !== id);
  guardar();
  dibujarLista();
  mostrarToast("Turno borrado");
}
 
// =====================================================
// 6. RESPALDO
// =====================================================
 
function descargarRespaldo() {
  const contenido = JSON.stringify(datos, null, 2);
  const archivo = new Blob([contenido], { type: "application/json" });
 
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(archivo);
  enlace.download = "respaldo-turnos-" + hoyISO() + ".json";
  enlace.click();
 
  mostrarToast("Respaldo descargado");
}
 
function cargarRespaldo(evento) {
  const archivo = evento.target.files[0];
  if (!archivo) return;
 
  const lector = new FileReader();
  lector.onload = () => {
    try {
      const nuevo = JSON.parse(lector.result);
      if (!Array.isArray(nuevo.turnos)) throw new Error("Formato inválido");
 
      if (!confirm("Esto reemplaza los turnos actuales. ¿Seguir?")) return;
 
      datos = { ...datos, ...nuevo };
      guardar();
      $("negocio").value = datos.negocio;
      $("plantilla").value = datos.plantilla;
      dibujarLista();
      mostrarToast("Respaldo cargado");
    } catch (error) {
      mostrarToast("El archivo no es válido");
    }
  };
  lector.readAsText(archivo);
  evento.target.value = ""; // permite elegir el mismo archivo otra vez
}
 
// =====================================================
// 7. DIBUJAR LA LISTA
// =====================================================
 
function limpiarTexto(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}
 
function htmlDeTurno(turno) {
  const apagado =
    turno.estado === "cancelado" || turno.estado === "ausente" ? "apagada" : "";
 
  // El botón de WhatsApp existe solo si cargaron teléfono
  const botonWhatsapp = turno.telefono
    ? `<button class="btn-whatsapp" onclick="enviarRecordatorio(${turno.id})">
         <i class="bi bi-whatsapp"></i> Recordar
       </button>`
    : "";
 
  return `
    <div class="tarjeta ${apagado}">
      <div class="turno-cabecera">
        <div>
          <span class="hora">${turno.hora}</span> · ${limpiarTexto(turno.nombre)}
        </div>
        <span class="estado ${turno.estado}">${turno.estado}</span>
      </div>
 
      <div class="acciones">
        ${botonWhatsapp}
        <button onclick="cambiarEstado(${turno.id}, 'confirmado')"><i class="bi bi-check-lg"></i></button>
        <button onclick="cambiarEstado(${turno.id}, 'cancelado')"><i class="bi bi-x-lg"></i></button>
        <button onclick="cambiarEstado(${turno.id}, 'ausente')"><i class="bi bi-person-x"></i></button>
        <button onclick="editarTurno(${turno.id})"><i class="bi bi-pencil"></i></button>
        <button onclick="borrarTurno(${turno.id})"><i class="bi bi-trash"></i></button>
      </div>
    </div>
  `;
}
 
function dibujarLista() {
  const proximos = datos.turnos
    .filter((t) => t.fecha >= hoyISO())
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
 
  $("contador").textContent = proximos.length + " próximos";
 
  if (proximos.length === 0) {
    $("lista").innerHTML = '<div class="vacio">Sin turnos. Escribí un nombre y una hora.</div>';
    return;
  }
 
  let html = "";
  let diaAnterior = "";
 
  proximos.forEach((turno) => {
    if (turno.fecha !== diaAnterior) {
      diaAnterior = turno.fecha;
      html += `<h2>${nombreDelDia(turno.fecha)}</h2>`;
    }
    html += htmlDeTurno(turno);
  });
 
  $("lista").innerHTML = html;
}
 
// =====================================================
// 8. ARRANQUE
// =====================================================
 
cargar();
 
$("fecha").value = hoyISO();
$("negocio").value = datos.negocio;
$("plantilla").value = datos.plantilla;
 
$("btn-agregar").onclick = guardarTurno;
 
// Enter en nombre u hora también guarda el turno
[$("nombre"), $("hora")].forEach((campo) => {
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter") guardarTurno();
  });
});
 
$("negocio").oninput = (e) => { datos.negocio = e.target.value; guardar(); };
$("plantilla").oninput = (e) => { datos.plantilla = e.target.value; guardar(); };
 
$("btn-exportar").onclick = descargarRespaldo;
$("btn-importar").onclick = () => $("archivo").click();
$("archivo").onchange = cargarRespaldo;
 
dibujarLista();