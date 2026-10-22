// 1. DATOS
// =====================================================
 
const CLAVE_GUARDADO = "turnos_v1";

let datos = {
  turnos: [],
  negocio: "",
  plantilla:
    "Hola {nombre}! Te recordamos tu turno {dia} a las {hora} en {negocio}. ¿Me confirmás? 🙌",
  horario: { inicio: "09:00", fin: "20:00", duracion: 30 },
    precioCorte: null,
  porcentaje: null,
  cortes: [],
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
  actualizarHoraSeleccionada("");
  $("telefono").value = "";
  $("fecha").value = hoyISO();
  $("btn-agregar").innerHTML = '<i class="bi bi-plus-lg" aria-hidden="true"></i>';
  $("btn-agregar").setAttribute("aria-label", "Agregar turno");
  $("btn-agregar").title = "Agregar turno";
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
  actualizarHoraSeleccionada(turno.hora);
  $("fecha").value = turno.fecha;
  $("telefono").value = turno.telefono;
  $("btn-agregar").innerHTML = '<i class="bi bi-check-lg" aria-hidden="true"></i>';
  $("btn-agregar").setAttribute("aria-label", "Guardar cambios del turno");
  $("btn-agregar").title = "Guardar cambios del turno";
 
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
// HORARIOS DISPONIBLES
// =====================================================

const aMinutos = (hora) => {
  const [h, m] = hora.split(":");
  return Number(h) * 60 + Number(m);
};

const aTexto = (minutos) =>
  String(Math.floor(minutos / 60)).padStart(2, "0") + ":" +
  String(minutos % 60).padStart(2, "0");

function horariosDelDia(fecha) {
  const { inicio, fin, duracion } = datos.horario;

  // Minutos de los turnos que siguen ocupando lugar ese día
  const ocupados = datos.turnos
    .filter((t) => t.fecha === fecha && t.estado !== "cancelado" && t.estado !== "ausente" && t.id !== editandoId)
    .map((t) => aMinutos(t.hora));

  const ahora = new Date();
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  const lista = [];

  for (let m = aMinutos(inicio); m < aMinutos(fin); m += duracion) {
    const ocupado = ocupados.some((o) => o >= m && o < m + duracion);
    const pasado = fecha === hoyISO() && m <= minutosAhora;
    lista.push({ hora: aTexto(m), libre: !ocupado && !pasado });
  }
  return lista;
}

function dibujarGrilla() {
  const fecha = $("modal-fecha").value;
  $("modal-grilla").innerHTML = horariosDelDia(fecha)
    .map((h) =>
      h.libre
        ? `<button onclick="elegirHorario('${h.hora}')">${h.hora}</button>`
        : `<button disabled>${h.hora}</button>`
    )
    .join("");
}

function abrirModal() {
  $("modal-fecha").value = $("fecha").value || hoyISO();
  dibujarGrilla();
  $("modal-horarios").showModal();
}

function elegirHorario(hora) {
  $("hora").value = hora;
  actualizarHoraSeleccionada(hora);
  $("fecha").value = $("modal-fecha").value; // el turno queda en el día elegido
  $("modal-horarios").close();
  $("nombre").focus();
}

function actualizarHoraSeleccionada(hora) {
  const etiqueta = hora ? "Cambiar hora, " + hora : "Elegir hora disponible";
  $("hora-seleccionada").textContent = hora || "Elegir hora";
  $("btn-horarios").setAttribute("aria-label", etiqueta);
  $("btn-horarios").title = etiqueta;
}
// =====================================================
// CAJA
// =====================================================

const pesos = (n) => "$" + Math.round(n).toLocaleString("es-AR");

function configurado() {
  return datos.precioCorte > 0 && datos.porcentaje > 0;
}

function abrirConfig() {
  $("cfg-precio").value = datos.precioCorte || "";
  $("cfg-porcentaje").value = datos.porcentaje || "";
  $("cfg-error").textContent = "";
  $("modal-config").showModal();
}

function guardarConfig() {
  const precio = Number($("cfg-precio").value);
  const porcentaje = Number($("cfg-porcentaje").value);

  if (!(precio > 0) || !(porcentaje > 0 && porcentaje <= 100)) {
    $("cfg-error").textContent = "Poné un precio y un porcentaje entre 1 y 100";
    return;
  }

  datos.precioCorte = precio;
  datos.porcentaje = porcentaje;
  guardar();
  $("modal-config").close();
  if ($("panel-caja").open) dibujarPanel();
  mostrarToast("Valores guardados");
}

// Guarda un corte con el % vigente en este momento
function registrarCorte(nombre, precio, fecha) {
  const ahora = new Date();
  const hora = String(ahora.getHours()).padStart(2, "0") + ":" +
               String(ahora.getMinutes()).padStart(2, "0");

  datos.cortes.push({
    id: Date.now(),
    fecha,
    hora,
    nombre,
    precio,
    porcentaje: datos.porcentaje,
  });
  guardar();
}

// Botón "$" de un turno
function cobrarTurno(id) {
  if (!configurado()) { abrirConfig(); return; }

  const turno = datos.turnos.find((t) => t.id === id);
  registrarCorte(turno.nombre, datos.precioCorte, hoyISO());
  turno.cobrado = true;
  turno.estado = "confirmado";
  guardar();
  dibujarLista();
  mostrarToast("Cobrado " + pesos(datos.precioCorte));
}

// Carga manual desde el panel (sin turno, o con otro precio)
function agregarCorteManual() {
  const nombre = $("corte-nombre").value.trim() || "Sin nombre";
  const precio = Number($("corte-precio").value) || datos.precioCorte;

  registrarCorte(nombre, precio, $("panel-fecha").value);
  $("corte-nombre").value = "";
  $("corte-precio").value = "";
  dibujarPanel();
}

function cambiarPrecioCorte(id) {
  const corte = datos.cortes.find((c) => c.id === id);
  const nuevo = Number(prompt("Nuevo precio", corte.precio));
  if (nuevo > 0) {
    corte.precio = nuevo;
    guardar();
    dibujarPanel();
  }
}
  function confirmar(texto, accion, textoBoton = "Borrar") {
  $("confirmar-texto").textContent = texto;
  $("btn-confirmar-si").textContent = textoBoton;

  $("btn-confirmar-si").onclick = () => {
    $("modal-confirmar").close();
    accion();
  };
  $("btn-confirmar-no").onclick = () => $("modal-confirmar").close();

  $("modal-confirmar").showModal();
}
function borrarTurno(id) {
  const turno = datos.turnos.find((t) => t.id === id);

  confirmar(`¿Borrar el turno de ${turno.nombre} a las ${turno.hora}?`, () => {
    datos.turnos = datos.turnos.filter((t) => t.id !== id);
    guardar();
    dibujarLista();
    mostrarToast("Turno borrado");
  });
}

function borrarCorte(id) {
  const corte = datos.cortes.find((c) => c.id === id);

  confirmar(`¿Borrar el corte de ${corte.nombre} (${pesos(corte.precio)})?`, () => {
    datos.cortes = datos.cortes.filter((c) => c.id !== id);
    guardar();
    dibujarPanel();
    mostrarToast("Corte borrado");
  });
}

function abrirPanel() {
  if (!configurado()) { abrirConfig(); return; }
  $("panel-fecha").value = $("panel-fecha").value || hoyISO();
  dibujarPanel();
  $("panel-caja").showModal();
}

function dibujarPanel() {
  const verMes = $("panel-modo").value === "mes";
  const fecha = $("panel-fecha").value;

  const lista = datos.cortes
    .filter((c) => verMes ? c.fecha.slice(0, 7) === fecha.slice(0, 7) : c.fecha === fecha)
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));

  const total = lista.reduce((suma, c) => suma + c.precio, 0);
  const paraMi = lista.reduce((suma, c) => suma + c.precio * c.porcentaje / 100, 0);

  $("panel-resumen").innerHTML = `
    <div><span class="texto-suave">Cortes</span><strong>${lista.length}</strong></div>
    <div><span class="texto-suave">Total cobrado</span><strong>${pesos(total)}</strong></div>
    <div><span class="texto-suave">Te queda</span><strong class="destacado">${pesos(paraMi)}</strong></div>
  `;

  if (lista.length === 0) {
    $("panel-lista").innerHTML = '<div class="vacio">Todavía no hay cortes registrados.</div>';
    return;
  }

  $("panel-lista").innerHTML = lista.map((c) => `
    <div class="fila-corte">
      <span>
        ${verMes ? c.fecha.slice(8) + "/" + c.fecha.slice(5, 7) + " · " : ""}${c.hora} · ${limpiarTexto(c.nombre)}
      </span>
      <span>
        <button onclick="cambiarPrecioCorte(${c.id})">${pesos(c.precio)}</button>
        <button onclick="borrarCorte(${c.id})"><i class="bi bi-trash"></i></button>
      </span>
    </div>
  `).join("");
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
  const botonCobrar = turno.cobrado
  ? `<span class="texto-suave"><i class="bi bi-cash-coin"></i> Cobrado</span>`
  : `<button onclick="cobrarTurno(${turno.id})"><i class="bi bi-cash-coin"></i></button>`;
 
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
        ${botonCobrar}
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
 $("btn-horarios").onclick = abrirModal;
$("modal-fecha").onchange = dibujarGrilla;
$("btn-cerrar-modal").onclick = () => $("modal-horarios").close();
cargar();
 
$("fecha").value = hoyISO();
$("negocio").value = datos.negocio;
$("plantilla").value = datos.plantilla;
 
$("btn-agregar").onclick = guardarTurno;
 
// Enter en el nombre también guarda el turno
$("nombre").addEventListener("keydown", (e) => {
  if (e.key === "Enter") guardarTurno();
});

$("btn-panel").onclick = abrirPanel;
$("btn-cerrar-panel").onclick = () => $("panel-caja").close();
$("btn-config").onclick = abrirConfig;
$("btn-guardar-config").onclick = guardarConfig;
$("btn-cancelar-config").onclick = () => $("modal-config").close();
$("btn-corte").onclick = agregarCorteManual;
$("panel-modo").onchange = dibujarPanel;
$("panel-fecha").onchange = dibujarPanel;

dibujarLista();