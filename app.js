"use strict";

// =====================================================
// CONSTANTES
// =====================================================

const CLAVE_GUARDADO = "turnos_v1";
const ESTADOS_TURNO = ["pendiente", "confirmado", "cancelado", "ausente"];
// Un turno cancelado o ausente libera su horario
const ESTADOS_SIN_LUGAR = ["cancelado", "ausente"];
const PATRON_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PLANTILLA_INICIAL =
  "Hola {nombre}! Te recordamos tu turno {dia} a las {hora} en {negocio}. ¿Me confirmás? 🙌";
const MAX_NOMBRE = 80;
const MAX_SERVICIO = 60;
const DURACION_TOAST = 2500;

// =====================================================
// UTILIDADES
// =====================================================

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
// Escapa texto para meterlo en HTML (contenido o atributos)
const esc = (texto) =>
  String(texto ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

const pesos = (n) => "$" + Math.round(n).toLocaleString("es-AR");
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const sinAcentos = (texto) =>
  String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// IDs únicos aunque se creen varios en el mismo milisegundo
let ultimoId = 0;
function nuevoId() {
  ultimoId = Math.max(Date.now(), ultimoId + 1);
  return ultimoId;
}

// =====================================================
// FECHAS Y HORAS
// =====================================================

const aISO = (f) => `${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}`;
const hoyISO = () => aISO(new Date());

function mananaISO() {
  const f = new Date();
  f.setDate(f.getDate() + 1);
  return aISO(f);
}

function fechaValida(fecha) {
  if (!PATRON_FECHA.test(fecha)) return false;
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const valor = new Date(anio, mes - 1, dia);
  return (
    valor.getFullYear() === anio &&
    valor.getMonth() === mes - 1 &&
    valor.getDate() === dia
  );
}

const horaValida = (hora) => PATRON_HORA.test(hora || "");

function horaActual() {
  const ahora = new Date();
  return `${pad(ahora.getHours())}:${pad(ahora.getMinutes())}`;
}

function aMinutos(hora) {
  if (!horaValida(hora)) return NaN;
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

const aTexto = (minutos) =>
  `${pad(Math.floor(minutos / 60))}:${pad(minutos % 60)}`;

const fechaCorta = (f) => `${f.slice(8)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

function nombreDelDia(fechaISO) {
  if (fechaISO === hoyISO()) return "hoy";
  if (fechaISO === mananaISO()) return "mañana";

  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  return (
    "el " +
    new Date(anio, mes - 1, dia).toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
  );
}

// Título de cada grupo de la lista: "hoy · 24/11", "el jueves 26 de noviembre"
function tituloDelDia(fechaISO) {
  const nombre = nombreDelDia(fechaISO);
  if (nombre === "hoy" || nombre === "mañana") {
    return `${nombre} · ${fechaISO.slice(8)}/${fechaISO.slice(5, 7)}`;
  }
  return nombre;
}

function yaPaso(fecha, hora) {
  if (!fechaValida(fecha) || !horaValida(hora)) return false;
  return new Date(`${fecha}T${hora}:00`) < new Date();
}

const pasoElHorarioDelTurno = (turno) => yaPaso(turno.fecha, turno.hora);

const scrollSuave = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

// =====================================================
// DATOS Y PERSISTENCIA
// (todo lo que toca el almacenamiento está en esta sección)
// =====================================================

const datosIniciales = () => ({
  turnos: [],
  negocio: "",
  plantilla: PLANTILLA_INICIAL,
  horario: { inicio: "09:00", fin: "20:00", duracion: 30 },
  servicios: [],
  porcentaje: null,
  cortes: [],
});

let datos = datosIniciales();

// Si no es null, estamos editando ese turno en vez de crear uno nuevo
let editandoId = null;

// Deja los datos guardados con la forma que el resto del código espera,
// aunque vengan incompletos o de una versión vieja.
function normalizar(crudo) {
  const base = datosIniciales();
  if (!crudo || typeof crudo !== "object") return base;

  const lista = (x) =>
    Array.isArray(x) ? x.filter((e) => e && typeof e === "object") : [];

  const servicios = lista(crudo.servicios)
    .map((s) => ({
      ...s,
      id: Number(s.id),
      nombre: String(s.nombre ?? "").trim(),
      precio: Number(s.precio),
    }))
    .filter((s) => Number.isFinite(s.id) && s.nombre && s.precio > 0);

  // Migración: versiones viejas guardaban un único "precioCorte"
  if (Number(crudo.precioCorte) > 0 && servicios.length === 0) {
    servicios.push({
      id: nuevoId(),
      nombre: "Corte",
      precio: Number(crudo.precioCorte),
    });
  }

  const porcentaje = Number(crudo.porcentaje) > 0 ? Number(crudo.porcentaje) : null;

  const turnos = lista(crudo.turnos)
    .map((t) => ({
      ...t,
      id: Number(t.id),
      nombre: String(t.nombre ?? ""),
      telefono: String(t.telefono ?? ""),
      estado: ESTADOS_TURNO.includes(t.estado) ? t.estado : "pendiente",
      cobrado: Boolean(t.cobrado),
    }))
    .filter((t) => Number.isFinite(t.id) && fechaValida(t.fecha) && horaValida(t.hora));

  const cortes = lista(crudo.cortes)
    .map((c) => ({
      ...c,
      id: Number(c.id),
      nombre: String(c.nombre ?? ""),
      servicio: String(c.servicio || "Corte"),
      hora: horaValida(c.hora) ? c.hora : "00:00",
      precio: Number(c.precio),
      porcentaje: Number(c.porcentaje) > 0 ? Number(c.porcentaje) : porcentaje || 0,
    }))
    .filter((c) => Number.isFinite(c.id) && fechaValida(c.fecha) && c.precio > 0);

  const horario =
    crudo.horario && typeof crudo.horario === "object" ? crudo.horario : {};

  const resultado = {
    ...base,
    ...crudo,
    turnos,
    servicios,
    cortes,
    porcentaje,
    negocio: String(crudo.negocio ?? ""),
    plantilla:
      typeof crudo.plantilla === "string" ? crudo.plantilla : base.plantilla,
    horario: { ...base.horario, ...horario },
  };
  delete resultado.precioCorte;
  return resultado;
}

function cargar() {
  let guardado = null;
  try {
    guardado = localStorage.getItem(CLAVE_GUARDADO);
  } catch (error) {
    console.error("No se pudo leer lo guardado", error);
  }
  if (!guardado) {
    datos = datosIniciales();
    return;
  }

  try {
    datos = normalizar(JSON.parse(guardado));
  } catch (error) {
    console.error("Los datos guardados están dañados", error);
    // Se deja una copia para poder recuperarlos antes de que se pisen
    try {
      localStorage.setItem(CLAVE_GUARDADO + "_respaldo", guardado);
    } catch {
      /* sin espacio: no hay nada más que hacer */
    }
    datos = datosIniciales();
  }
}

function guardar() {
  try {
    localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(datos));
    return true;
  } catch (error) {
    console.error("No se pudo guardar", error);
    mostrarToast("No se pudo guardar. Revisá el espacio del navegador.");
    return false;
  }
}

// =====================================================
// AVISOS (TOAST)
// =====================================================

let temporizadorToast;
let temporizadorOcultar;

// Región invisible que los lectores de pantalla anuncian
function anunciar(texto) {
  const region = $("anuncios");
  region.textContent = "";
  setTimeout(() => {
    region.textContent = texto;
  }, 50);
}

function mostrarToast(texto) {
  const toast = $("toast");
  const conPopover = typeof toast.showPopover === "function";

  clearTimeout(temporizadorToast);
  clearTimeout(temporizadorOcultar);
  toast.textContent = texto;

  // Un popover se dibuja por encima de los diálogos abiertos;
  // sin esto los avisos quedaban tapados por el fondo oscuro.
  if (conPopover) {
    try {
      if (toast.matches(":popover-open")) toast.hidePopover();
      toast.showPopover();
    } catch {
      /* si falla, el aviso igual se muestra como un div común */
    }
  }
  void toast.offsetWidth; // fuerza el estilo inicial para que anime
  toast.classList.add("visible");
  anunciar(texto);

  temporizadorToast = setTimeout(() => {
    toast.classList.remove("visible");
    temporizadorOcultar = setTimeout(() => {
      if (!conPopover) return;
      try {
        toast.hidePopover();
      } catch {
        /* ya estaba cerrado */
      }
    }, 300);
  }, DURACION_TOAST);
}

// =====================================================
// EVENTOS: ayuda para no usar onclick dentro del HTML
// =====================================================

// Un solo listener por contenedor. Cada botón lleva data-accion y data-id.
function alClickear(idContenedor, acciones) {
  const contenedor = $(idContenedor);
  contenedor.addEventListener("click", (evento) => {
    const boton = evento.target.closest("[data-accion]");
    if (!boton || !contenedor.contains(boton) || boton.disabled) return;
    const accion = acciones[boton.dataset.accion];
    if (accion) accion(Number(boton.dataset.id), boton.dataset);
  });
}

// =====================================================
// CONFIRMAR Y PEDIR PRECIO (reemplazan a confirm() y prompt())
// =====================================================

let accionConfirmada = null;

function confirmar(texto, accion, textoBoton = "Borrar") {
  accionConfirmada = accion;
  $("confirmar-texto").textContent = texto;
  $("btn-confirmar-si").textContent = textoBoton;
  $("modal-confirmar").showModal();
}

function confirmarBorrado(registros, id, mensaje, redibujar, mensajeExito) {
  const registro = registros.find((r) => r.id === id);
  if (!registro) return;

  confirmar(mensaje(registro), () => {
    registros.splice(registros.indexOf(registro), 1);
    guardar();
    redibujar();
    mostrarToast(mensajeExito);
  });
}

let accionPrecio = null;

function pedirPrecio(titulo, precioActual, alGuardar) {
  accionPrecio = alGuardar;
  $("precio-titulo").textContent = titulo;
  $("precio-valor").value = precioActual;
  $("precio-error").textContent = "";
  $("modal-precio").showModal();
  $("precio-valor").select();
}

function guardarPrecioPedido() {
  const precio = Number($("precio-valor").value);
  if (!(precio > 0)) {
    $("precio-error").textContent = "Poné un precio mayor a cero";
    $("precio-valor").focus();
    return;
  }
  const accion = accionPrecio;
  accionPrecio = null;
  $("modal-precio").close();
  if (accion) accion(precio);
}

function cambiarPrecio(registros, id, titulo, redibujar) {
  const registro = registros.find((r) => r.id === id);
  if (!registro) return;

  pedirPrecio(titulo(registro), registro.precio, (precio) => {
    registro.precio = precio;
    guardar();
    redibujar();
    mostrarToast("Precio actualizado");
  });
}

// =====================================================
// WHATSAPP
// =====================================================

function formatearTelefono(telefono) {
  let numero = telefono.replace(/\D/g, "");
  if (numero.startsWith("54")) return numero;
  numero = numero.replace(/^0/, "");
  return "549" + numero;
}

function telefonoValido(telefono) {
  const digitos = telefono.replace(/\D/g, "");
  return digitos.length >= 8 && digitos.length <= 15;
}

function armarMensaje(turno) {
  const valores = {
    nombre: turno.nombre,
    dia: nombreDelDia(turno.fecha),
    hora: turno.hora,
    negocio: datos.negocio || "nuestro local",
  };
  const plantilla = (datos.plantilla || "").trim() || PLANTILLA_INICIAL;

  // Un solo recorrido: si el nombre del cliente contiene "{hora}" no se reemplaza
  return plantilla.replace(
    /\{(nombre|dia|hora|negocio)\}/g,
    (_, clave) => valores[clave],
  );
}

function enviarRecordatorio(id) {
  const turno = buscarTurno(id);
  if (!turno || !telefonoValido(turno.telefono)) {
    mostrarToast("El WhatsApp no es válido");
    return;
  }
  const link =
    "https://wa.me/" +
    formatearTelefono(turno.telefono) +
    "?text=" +
    encodeURIComponent(armarMensaje(turno));
  window.open(link, "_blank", "noopener,noreferrer");
}

// =====================================================
// HORARIOS DISPONIBLES
// =====================================================

const ocupaHorario = (turno) => !ESTADOS_SIN_LUGAR.includes(turno.estado);

function horariosDelDia(fecha) {
  const { inicio, fin, duracion } = datos.horario;
  if (
    !fechaValida(fecha) ||
    !horaValida(inicio) ||
    !horaValida(fin) ||
    !Number.isInteger(duracion) ||
    duracion < 5 ||
    duracion > 480 ||
    aMinutos(inicio) >= aMinutos(fin)
  ) {
    return [];
  }

  // Minutos de los turnos que siguen ocupando lugar ese día
  const ocupados = datos.turnos
    .filter((t) => t.fecha === fecha && ocupaHorario(t) && t.id !== editandoId)
    .map((t) => aMinutos(t.hora));

  const ahora = new Date();
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  const esHoy = fecha === hoyISO();
  const lista = [];

  for (let m = aMinutos(inicio); m < aMinutos(fin); m += duracion) {
    const ocupado = ocupados.some((o) => o >= m && o < m + duracion);
    const pasado = esHoy && m <= minutosAhora;
    lista.push({ hora: aTexto(m), libre: !ocupado && !pasado });
  }
  return lista;
}

const horarioLibre = (fecha, hora) =>
  horariosDelDia(fecha).some((slot) => slot.hora === hora && slot.libre);

// ¿Otro turno activo ya ocupa el lugar de este?
function hayChoque(turno) {
  const { duracion } = datos.horario;
  const minutos = aMinutos(turno.hora);
  return datos.turnos.some(
    (otro) =>
      otro.id !== turno.id &&
      otro.fecha === turno.fecha &&
      ocupaHorario(otro) &&
      Math.abs(aMinutos(otro.hora) - minutos) < duracion,
  );
}

function dibujarGrilla() {
  const fecha = $("modal-fecha").value;
  const grilla = $("modal-grilla");

  if (!fechaValida(fecha) || fecha < hoyISO()) {
    grilla.innerHTML = '<p class="texto-suave">Elegí hoy o una fecha futura.</p>';
    return;
  }

  const horarios = horariosDelDia(fecha);
  if (!horarios.some((h) => h.libre)) {
    grilla.innerHTML =
      '<p class="texto-suave">No quedan horarios libres ese día.</p>';
    return;
  }

  grilla.innerHTML = horarios
    .map((h) =>
      h.libre
        ? `<button type="button" data-accion="horario" data-hora="${h.hora}">${h.hora}</button>`
        : `<button type="button" disabled aria-label="${h.hora}, no disponible">${h.hora}</button>`,
    )
    .join("");
}

function abrirModal() {
  const fecha = $("fecha").value;
  $("modal-fecha").min = hoyISO();
  // Si la app quedó abierta de un día para otro, la fecha guardada puede ser vieja
  $("modal-fecha").value = fecha && fecha >= hoyISO() ? fecha : hoyISO();
  dibujarGrilla();
  $("modal-horarios").showModal();
}

function elegirHorario(hora) {
  $("hora").value = hora;
  $("fecha").value = $("modal-fecha").value; // el turno queda en el día elegido
  actualizarSeleccion();
  $("modal-horarios").close();
  ($("nombre").value.trim() ? $("btn-agregar") : $("nombre")).focus();
}

// Muestra en el formulario qué día y hora están elegidos
function actualizarSeleccion() {
  const hora = $("hora").value;
  const fecha = $("fecha").value;
  const etiqueta = hora ? "Cambiar horario, " + hora : "Elegir horario disponible";

  $("hora-seleccionada").textContent = hora;
  $("btn-horarios").classList.toggle("con-hora", Boolean(hora));
  $("btn-horarios").setAttribute("aria-label", etiqueta);
  $("btn-horarios").title = etiqueta;
  $("resumen-turno").textContent = hora
    ? `Turno ${nombreDelDia(fecha)} a las ${hora}`
    : "Todavía no elegiste horario.";
}

// =====================================================
// TURNOS
// =====================================================

const buscarTurno = (id) => datos.turnos.find((t) => t.id === id);

function ponerModoFormulario(turnoEditado) {
  const editando = Boolean(turnoEditado);
  const texto = editando ? "Guardar cambios del turno" : "Agregar turno";
  const boton = $("btn-agregar");

  boton.innerHTML = `<i class="bi bi-${editando ? "check-lg" : "plus-lg"}" aria-hidden="true"></i>`;
  boton.setAttribute("aria-label", texto);
  boton.title = texto;

  $("btn-cancelar-edicion").hidden = !editando;
  // En un turno ya cobrado el día y la hora no se pueden mover
  $("btn-horarios").disabled = Boolean(turnoEditado && turnoEditado.cobrado);
}

function limpiarFormulario({ enfocar = true } = {}) {
  editandoId = null;
  $("nombre").value = "";
  $("hora").value = "";
  $("fecha").value = hoyISO();
  $("telefono").value = "";
  ponerModoFormulario(null);
  actualizarSeleccion();
  if (enfocar) $("nombre").focus();
}

function errorDelTurno({ nombre, hora, fecha, telefono }, turnoEditado) {
  if (!nombre) return { mensaje: "Escribí el nombre del cliente", campo: "nombre" };
  if (nombre.length > MAX_NOMBRE) {
    return {
      mensaje: `El nombre no puede superar ${MAX_NOMBRE} caracteres`,
      campo: "nombre",
    };
  }
  if (!hora) return { mensaje: "Elegí un horario disponible", campo: "btn-horarios" };
  if (!fechaValida(fecha) || fecha < hoyISO()) {
    return { mensaje: "Elegí una fecha válida desde hoy", campo: "btn-horarios" };
  }
  if (telefono && !telefonoValido(telefono)) {
    return { mensaje: "Revisá el número de WhatsApp", campo: "telefono" };
  }

  // Si se corrige solo el nombre o el teléfono, el horario no cambia
  // y no hace falta que siga "libre" (puede que ya haya pasado).
  const mismoHorario =
    turnoEditado && turnoEditado.fecha === fecha && turnoEditado.hora === hora;

  if (turnoEditado && turnoEditado.cobrado && !mismoHorario) {
    return {
      mensaje: "Turno cobrado: solo podés corregir el nombre y el WhatsApp",
      campo: "nombre",
    };
  }
  if (!mismoHorario && !horarioLibre(fecha, hora)) {
    return { mensaje: "Ese horario ya no está disponible", campo: "btn-horarios" };
  }
  return null;
}

// Sirve para crear un turno nuevo y también para guardar una edición
function guardarTurno() {
  const turnoEditado = editandoId ? buscarTurno(editandoId) : null;

  if (editandoId && !turnoEditado) {
    // El turno se borró (por ejemplo desde otra pestaña) mientras se editaba
    limpiarFormulario();
    mostrarToast("Ese turno ya no existe");
    return;
  }

  const campos = {
    nombre: $("nombre").value.trim(),
    hora: $("hora").value,
    fecha: $("fecha").value,
    telefono: $("telefono").value.trim(),
  };

  const error = errorDelTurno(campos, turnoEditado);
  if (error) {
    mostrarToast(error.mensaje);
    $(error.campo).focus();
    return;
  }

  if (turnoEditado) {
    Object.assign(turnoEditado, campos);
    // El cobro guarda una copia del nombre: se mantiene al día
    const corte = datos.cortes.find((c) => c.turnoId === turnoEditado.id);
    if (corte) corte.nombre = turnoEditado.nombre;
    mostrarToast("Turno corregido");
  } else {
    datos.turnos.push({
      id: nuevoId(),
      ...campos,
      estado: "pendiente",
      cobrado: false,
    });
    mostrarToast("Turno agregado");
  }

  guardar();
  limpiarFormulario();
  dibujarLista();
}

// Carga los datos del turno en el formulario para corregirlos
function editarTurno(id) {
  const turno = buscarTurno(id);
  if (!turno) return;
  editandoId = id;

  $("nombre").value = turno.nombre;
  $("hora").value = turno.hora;
  $("fecha").value = turno.fecha;
  $("telefono").value = turno.telefono;
  ponerModoFormulario(turno);
  actualizarSeleccion();

  $("nombre").focus();
  window.scrollTo({ top: 0, behavior: scrollSuave() });
  mostrarToast("Corregí y tocá ✓");
}

function cancelarEdicion() {
  limpiarFormulario();
  mostrarToast("Edición cancelada");
}

function cambiarEstado(id, nuevoEstado) {
  const turno = buscarTurno(id);
  if (!turno || !ESTADOS_TURNO.includes(nuevoEstado)) return;

  if (turno.cobrado && nuevoEstado !== "confirmado") {
    mostrarToast("Ese turno ya está cobrado");
    return;
  }
  if (nuevoEstado === "ausente" && !pasoElHorarioDelTurno(turno)) {
    mostrarToast("Todavía no pasó el horario del turno");
    return;
  }
  // Reactivar un turno cancelado o ausente: su lugar pudo ser tomado por otro
  if (
    !ESTADOS_SIN_LUGAR.includes(nuevoEstado) &&
    !ocupaHorario(turno) &&
    hayChoque(turno)
  ) {
    mostrarToast("Ese horario ya lo ocupa otro turno");
    return;
  }

  turno.estado = nuevoEstado;
  guardar();
  dibujarLista();
  mostrarToast("Turno " + nuevoEstado);
}

function borrarTurno(id) {
  const turno = buscarTurno(id);
  if (!turno) return;

  const aviso = turno.cobrado ? " El cobro se mantiene en la Caja." : "";
  confirmar(`¿Borrar el turno de ${turno.nombre} (${turno.hora})?${aviso}`, () => {
    datos.turnos = datos.turnos.filter((t) => t.id !== id);
    // Si justo se estaba editando, se cancela la edición
    if (editandoId === id) limpiarFormulario({ enfocar: false });
    guardar();
    dibujarLista();
    mostrarToast("Turno borrado");
  });
}

// =====================================================
// LISTA DE TURNOS
// =====================================================

function htmlDeTurno(turno) {
  const nombre = esc(turno.nombre);
  const apagado = ocupaHorario(turno) ? "" : "apagada";
  const paso = pasoElHorarioDelTurno(turno);

  const boton = (accion, icono, etiqueta, clase = "") => `
    <button type="button" class="${clase}" data-accion="${accion}" data-id="${turno.id}"
      aria-label="${etiqueta}, ${nombre}" title="${etiqueta}">
      <i class="bi bi-${icono}" aria-hidden="true"></i>
    </button>`;

  // El botón de WhatsApp existe solo si cargaron teléfono
  const botonWhatsapp = turno.telefono
    ? `<button type="button" class="btn-whatsapp" data-accion="recordar" data-id="${turno.id}"
         aria-label="Recordar por WhatsApp, ${nombre}">
         <i class="bi bi-whatsapp" aria-hidden="true"></i> Recordar
       </button>`
    : "";

  let botonCobrar = "";
  if (turno.cobrado) {
    botonCobrar = `<span class="texto-suave cobrado"><i class="bi bi-cash-coin" aria-hidden="true"></i> Cobrado</span>`;
  } else if (paso && ocupaHorario(turno)) {
    botonCobrar = boton("cobrar", "cash-coin", "Cobrar");
  }

  const botonesEstado = turno.cobrado
    ? ""
    : boton("confirmar", "check-lg", "Confirmar turno") +
      boton("cancelar", "x-lg", "Cancelar turno") +
      (paso ? boton("ausente", "person-x", "Marcar ausente") : "");

  return `
    <li class="tarjeta turno ${apagado}" data-estado="${turno.estado}">
      <div class="turno-cabecera">
        <div class="turno-datos">
          <span class="hora">${turno.hora}</span>
          <span class="turno-nombre">${nombre}</span>
        </div>
        <span class="estado ${turno.estado}">${turno.estado}</span>
      </div>
      <div class="acciones">
        ${botonWhatsapp}
        ${botonCobrar}
        ${botonesEstado}
        ${boton("editar", "pencil", "Editar turno")}
        ${boton("borrar", "trash", "Borrar turno")}
      </div>
    </li>`;
}

function dibujarLista() {
  // Al redibujar se pierde el foco: se guarda cuál botón lo tenía para devolvérselo
  const activo = document.activeElement;
  const focoPrevio =
    activo && $("lista").contains(activo) && activo.dataset.accion
      ? { accion: activo.dataset.accion, id: activo.dataset.id }
      : null;

  const hoy = hoyISO();
  const proximos = datos.turnos
    .filter((t) => t.fecha >= hoy)
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));

  // "Próximos" = turnos activos que todavía no llegaron
  const cantidad = proximos.filter(
    (t) => ocupaHorario(t) && !pasoElHorarioDelTurno(t),
  ).length;
  $("contador").textContent = plural(cantidad, "próximo", "próximos");

  if (proximos.length === 0) {
    $("lista").innerHTML =
      '<div class="vacio">Sin turnos. Escribí un nombre y elegí un horario.</div>';
  } else {
    let html = "";
    let diaAnterior = "";

    proximos.forEach((turno) => {
      if (turno.fecha !== diaAnterior) {
        if (diaAnterior) html += "</ul>";
        diaAnterior = turno.fecha;
        html += `<h2 class="dia">${esc(tituloDelDia(turno.fecha))}</h2><ul class="turnos">`;
      }
      html += htmlDeTurno(turno);
    });
    $("lista").innerHTML = html + "</ul>";
  }

  if (focoPrevio) {
    const lista = $("lista");
    const mismo =
      lista.querySelector(
        `[data-accion="${focoPrevio.accion}"][data-id="${focoPrevio.id}"]`,
      ) || lista.querySelector(`[data-id="${focoPrevio.id}"]`);
    (mismo || lista).focus({ preventScroll: true });
  }
}

// Los botones "Cobrar" y "Ausente" dependen de la hora: se refrescan solos
function refrescarSiHaceFalta() {
  if (document.querySelector("dialog[open]")) return;
  if ($("lista").contains(document.activeElement)) return;
  dibujarLista();
}

// =====================================================
// CONFIGURACIÓN: porcentaje y servicios
// =====================================================

const configurado = () => datos.servicios.length > 0 && datos.porcentaje > 0;

function exigirConfiguracion() {
  if (configurado()) return true;
  mostrarToast("Primero cargá tu porcentaje y al menos un servicio");
  abrirConfig();
  return false;
}

function abrirConfig() {
  $("cfg-porcentaje").value = datos.porcentaje || "";
  $("cfg-error").textContent = "";
  dibujarServicios();
  $("modal-config").showModal();
}

function guardarConfig() {
  const porcentaje = Number($("cfg-porcentaje").value);

  if (!(porcentaje > 0 && porcentaje <= 100)) {
    $("cfg-error").textContent = "El porcentaje tiene que estar entre 1 y 100";
    $("cfg-porcentaje").focus();
    return;
  }
  if (datos.servicios.length === 0) {
    $("cfg-error").textContent = "Agregá al menos un servicio";
    $("srv-nombre").focus();
    return;
  }

  datos.porcentaje = porcentaje;
  guardar();
  $("modal-config").close();
  mostrarToast("Valores guardados");
}

function dibujarServicios() {
  if (datos.servicios.length === 0) {
    $("cfg-servicios").innerHTML =
      '<div class="texto-suave">Todavía no cargaste servicios.</div>';
    return;
  }

  $("cfg-servicios").innerHTML = datos.servicios
    .map(
      (s) => `
    <div class="fila-corte">
      <span>${esc(s.nombre)}</span>
      <span class="acciones-fila">
        <button type="button" data-accion="precio-servicio" data-id="${s.id}"
          aria-label="Cambiar precio de ${esc(s.nombre)}, ahora ${pesos(s.precio)}"
          title="Cambiar precio">${pesos(s.precio)}</button>
        <button type="button" data-accion="borrar-servicio" data-id="${s.id}"
          aria-label="Borrar servicio ${esc(s.nombre)}" title="Borrar servicio">
          <i class="bi bi-trash" aria-hidden="true"></i>
        </button>
      </span>
    </div>`,
    )
    .join("");
}

function agregarServicio() {
  const nombre = $("srv-nombre").value.trim();
  const precio = Number($("srv-precio").value);

  if (!nombre || !(precio > 0)) {
    $("cfg-error").textContent = "Poné el nombre y el precio del servicio";
    return;
  }
  if (nombre.length > MAX_SERVICIO) {
    $("cfg-error").textContent = `El nombre no puede superar ${MAX_SERVICIO} caracteres`;
    return;
  }

  datos.servicios.push({ id: nuevoId(), nombre, precio });
  guardar();

  $("srv-nombre").value = "";
  $("srv-precio").value = "";
  $("cfg-error").textContent = "";
  dibujarServicios();
  $("srv-nombre").focus();
}

function cambiarPrecioServicio(id) {
  cambiarPrecio(
    datos.servicios,
    id,
    (servicio) => "Nuevo precio de " + servicio.nombre,
    dibujarServicios,
  );
}

function borrarServicio(id) {
  confirmarBorrado(
    datos.servicios,
    id,
    (servicio) =>
      `¿Borrar "${servicio.nombre}"? Los cortes ya registrados no cambian.`,
    dibujarServicios,
    "Servicio borrado",
  );
}

// =====================================================
// COBROS
// =====================================================

// Id del turno que se está cobrando mientras se elige el servicio
let turnoACobrarId = null;

function registrarCorte({
  nombre,
  servicio,
  precio,
  fecha,
  hora = horaActual(),
  turnoId = null,
  manual = false,
}) {
  datos.cortes.push({
    id: nuevoId(),
    fecha,
    hora,
    nombre,
    servicio, // nombre del servicio en el momento del cobro
    precio,
    porcentaje: datos.porcentaje, // % vigente en el momento del cobro
    ...(turnoId !== null ? { turnoId } : {}),
    ...(manual ? { manual: true } : {}),
  });
}

// Devuelve el motivo por el que un turno no se puede cobrar, o null si se puede
function motivoNoCobrable(turno) {
  if (turno.cobrado) return "Ese turno ya está cobrado";
  if (!ocupaHorario(turno)) {
    return `El turno está ${turno.estado}. Confirmalo antes de cobrar.`;
  }
  if (!pasoElHorarioDelTurno(turno)) return "Todavía no llegó el horario del turno";
  return null;
}

// Botón "$" de un turno
function cobrarTurno(id) {
  if (!exigirConfiguracion()) return;

  const turno = buscarTurno(id);
  if (!turno) return;

  const motivo = motivoNoCobrable(turno);
  if (motivo) {
    mostrarToast(motivo);
    return;
  }

  // Con un solo servicio no hace falta preguntar
  if (datos.servicios.length === 1) {
    cobrarConServicio(id, datos.servicios[0].id);
    return;
  }

  turnoACobrarId = id;
  $("elegir-titulo").textContent = "¿Qué le hiciste a " + turno.nombre + "?";
  $("elegir-lista").innerHTML = datos.servicios
    .map(
      (s) => `
    <button type="button" data-accion="servicio" data-id="${s.id}">
      <span>${esc(s.nombre)}</span>
      <strong>${pesos(s.precio)}</strong>
    </button>`,
    )
    .join("");
  $("modal-elegir").showModal();
}

function cobrarConServicio(turnoId, servicioId) {
  const turno = buscarTurno(turnoId);
  const servicio = datos.servicios.find((s) => s.id === servicioId);

  if ($("modal-elegir").open) $("modal-elegir").close();
  if (!turno || !servicio) return;

  // Se vuelve a chequear: el estado pudo cambiar mientras el diálogo estaba abierto
  const motivo = motivoNoCobrable(turno);
  if (motivo) {
    mostrarToast(motivo);
    return;
  }

  registrarCorte({
    nombre: turno.nombre,
    servicio: servicio.nombre,
    precio: servicio.precio,
    fecha: turno.fecha,
    hora: turno.hora,
    turnoId: turno.id,
  });
  turno.cobrado = true;
  turno.estado = "confirmado";
  guardar();

  dibujarLista();
  mostrarToast(`Cobrado ${servicio.nombre} ${pesos(servicio.precio)}`);
}

function agregarCorteManual() {
  const servicio = datos.servicios.find(
    (s) => s.id === Number($("corte-servicio").value),
  );
  if (!servicio) {
    mostrarToast("Elegí un servicio");
    $("corte-servicio").focus();
    return;
  }

  const nombre = $("corte-nombre").value.trim() || "Sin nombre";
  const hora = $("corte-hora").value;
  const fecha = $("panel-fecha").value;

  if (nombre.length > MAX_NOMBRE) {
    mostrarToast(`El nombre no puede superar ${MAX_NOMBRE} caracteres`);
    $("corte-nombre").focus();
    return;
  }
  if (!fechaValida(fecha)) {
    mostrarToast("Elegí una fecha válida");
    $("panel-fecha").focus();
    return;
  }
  if (!horaValida(hora)) {
    mostrarToast("Elegí un horario válido");
    $("corte-hora").focus();
    return;
  }
  if (fecha > hoyISO()) {
    mostrarToast("No podés registrar un corte en una fecha futura");
    return;
  }
  if (fecha === hoyISO() && hora > horaActual()) {
    mostrarToast("No podés registrar un corte en un horario futuro");
    $("corte-hora").focus();
    return;
  }

  registrarCorte({
    nombre,
    servicio: servicio.nombre,
    precio: servicio.precio,
    fecha,
    hora,
    manual: true,
  });
  guardar();
  $("corte-nombre").value = "";
  dibujarPanel();
  mostrarToast("Corte registrado");
}

function cambiarPrecioCorte(id) {
  cambiarPrecio(
    datos.cortes,
    id,
    (corte) => "Nuevo precio del corte de " + corte.nombre,
    dibujarPanel,
  );
}

function borrarCorte(id) {
  confirmarBorrado(
    datos.cortes,
    id,
    (corte) => `¿Borrar el corte de ${corte.nombre} (${pesos(corte.precio)})?`,
    dibujarPanel,
    "Corte borrado",
  );
}

// =====================================================
// CAJA
// =====================================================

function abrirPanel() {
  if (!exigirConfiguracion()) return;

  $("panel-fecha").max = hoyISO();
  if (!fechaValida($("panel-fecha").value)) $("panel-fecha").value = hoyISO();
  $("corte-hora").value = horaActual();
  dibujarPanel();
  $("panel-caja").showModal();
}

function resumirCortes(lista) {
  return lista.reduce(
    (resultado, corte) => {
      resultado.total += corte.precio;
      resultado.paraMi += (corte.precio * corte.porcentaje) / 100;

      const nombre = corte.servicio || "Corte";
      const detalle = resultado.porServicio.get(nombre) || { cantidad: 0, total: 0 };
      detalle.cantidad++;
      detalle.total += corte.precio;
      resultado.porServicio.set(nombre, detalle);
      return resultado;
    },
    { total: 0, paraMi: 0, porServicio: new Map() },
  );
}

function htmlDeCorte(corte, verMes) {
  const dia = verMes ? `${corte.fecha.slice(8)}/${corte.fecha.slice(5, 7)} · ` : "";
  const nombre = esc(corte.nombre);
  return `
    <div class="fila-corte">
      <span>
        ${dia}${corte.hora} · ${nombre}
        <span class="texto-suave detalle">${esc(corte.servicio || "Corte")}</span>
      </span>
      <span class="acciones-fila">
        <button type="button" data-accion="precio-corte" data-id="${corte.id}"
          aria-label="Cambiar precio del corte de ${nombre}, ahora ${pesos(corte.precio)}"
          title="Cambiar precio">${pesos(corte.precio)}</button>
        <button type="button" data-accion="borrar-corte" data-id="${corte.id}"
          aria-label="Borrar corte de ${nombre}" title="Borrar corte">
          <i class="bi bi-trash" aria-hidden="true"></i>
        </button>
      </span>
    </div>`;
}

function dibujarPanel() {
  // Selector de servicios de la carga manual (conserva lo elegido)
  const selector = $("corte-servicio");
  const elegido = selector.value;
  selector.innerHTML = datos.servicios
    .map((s) => `<option value="${s.id}">${esc(s.nombre)} · ${pesos(s.precio)}</option>`)
    .join("");
  if (elegido) selector.value = elegido;

  const verMes = $("panel-modo").value === "mes";
  const fecha = fechaValida($("panel-fecha").value) ? $("panel-fecha").value : hoyISO();

  const lista = datos.cortes
    .filter((c) =>
      verMes ? c.fecha.slice(0, 7) === fecha.slice(0, 7) : c.fecha === fecha,
    )
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));

  const resumen = resumirCortes(lista);

  $("panel-resumen").innerHTML = `
    <div><span class="texto-suave">Cortes</span><strong>${lista.length}</strong></div>
    <div><span class="texto-suave">Total cobrado</span><strong>${pesos(resumen.total)}</strong></div>
    <div><span class="texto-suave">Te queda</span><strong class="destacado">${pesos(resumen.paraMi)}</strong></div>
  `;

  $("panel-desglose").innerHTML = [...resumen.porServicio]
    .map(
      ([nombre, detalle]) => `
    <div class="fila-corte">
      <span>${esc(nombre)} × ${detalle.cantidad}</span>
      <strong>${pesos(detalle.total)}</strong>
    </div>`,
    )
    .join("");

  $("panel-lista").innerHTML =
    lista.length === 0
      ? '<div class="vacio">Todavía no hay cortes registrados.</div>'
      : lista.map((c) => htmlDeCorte(c, verMes)).join("");
}

// =====================================================
// HISTORIAL
// =====================================================

// Un cobro aparece suelto en el historial si no tiene un turno que lo represente:
// carga manual, turno borrado, o cobros viejos sin turnoId.
function esCorteSuelto(corte) {
  if (corte.manual) return true;
  if (corte.turnoId != null) {
    return !datos.turnos.some((t) => t.id === corte.turnoId);
  }
  const nombre = sinAcentos(corte.nombre);
  return !datos.turnos.some(
    (t) => t.cobrado && t.fecha === corte.fecha && sinAcentos(t.nombre) === nombre,
  );
}

function turnosAnteriores(busqueda) {
  const hoy = hoyISO();
  const coincide = (nombre) => !busqueda || sinAcentos(nombre).includes(busqueda);

  const turnos = datos.turnos.filter((t) => t.fecha < hoy && coincide(t.nombre));
  const cobrosSueltos = datos.cortes
    .filter((c) => c.fecha < hoy && coincide(c.nombre) && esCorteSuelto(c))
    .map((c) => ({ ...c, estado: "atendido" }));

  return [...turnos, ...cobrosSueltos].sort((a, b) =>
    (b.fecha + b.hora).localeCompare(a.fecha + a.hora),
  );
}

function abrirHistorial() {
  $("hist-buscar").value = "";
  dibujarHistorial();
  $("modal-historial").showModal();
}

function dibujarHistorial() {
  const busqueda = sinAcentos($("hist-buscar").value.trim());
  const pasados = turnosAnteriores(busqueda);

  if (pasados.length === 0) {
    $("hist-lista").innerHTML = `<div class="vacio">${
      busqueda ? "No hay turnos anteriores para esa búsqueda." : "No hay turnos anteriores."
    }</div>`;
    return;
  }

  // Al buscar un cliente, un resumen de sus visitas
  let resumen = "";
  if (busqueda) {
    const ausencias = pasados.filter((t) => t.estado === "ausente").length;
    const atendidos = pasados.filter(
      (t) => t.cobrado || t.estado === "confirmado" || t.estado === "atendido",
    ).length;
    resumen = `
      <div class="tarjeta">
        <strong>${plural(pasados.length, "turno", "turnos")}</strong> ·
        ${plural(atendidos, "atendido", "atendidos")} ·
        ${plural(ausencias, "ausencia", "ausencias")}
        <div class="texto-suave">Última visita: ${fechaCorta(pasados[0].fecha)}</div>
      </div>`;
  }

  $("hist-lista").innerHTML =
    resumen +
    pasados
      .map(
        (t) => `
    <div class="fila-corte">
      <span>${fechaCorta(t.fecha)} · ${t.hora} · ${esc(t.nombre)}</span>
      <span class="estado ${t.estado}">${t.estado}</span>
    </div>`,
      )
      .join("");
}

// =====================================================
// SINCRONIZACIÓN ENTRE PESTAÑAS
// =====================================================

function redibujarTodo() {
  // Si el turno que se estaba editando ya no existe, se cancela la edición
  if (editandoId && !buscarTurno(editandoId)) limpiarFormulario({ enfocar: false });
  dibujarLista();
  if ($("modal-historial").open) dibujarHistorial();
  if ($("panel-caja").open) dibujarPanel();
}

window.addEventListener("storage", (evento) => {
  if (evento.key !== CLAVE_GUARDADO || !evento.newValue) return;

  try {
    const actualizados = JSON.parse(evento.newValue);
    if (!actualizados || !Array.isArray(actualizados.turnos)) {
      throw new Error("Los datos guardados no contienen una lista de turnos");
    }
    datos = normalizar(actualizados);
    redibujarTodo();
  } catch (error) {
    console.error("No se pudo sincronizar los turnos de otra pestaña", error);
  }
});

// =====================================================
// INICIO
// =====================================================

function iniciar() {
  cargar();

  $("fecha").value = hoyISO();
  $("negocio").value = datos.negocio;
  $("plantilla").value = datos.plantilla;
  ponerModoFormulario(null);
  actualizarSeleccion();

  // Formulario de turnos (Enter en cualquier campo también envía)
  $("form-turno").addEventListener("submit", (e) => {
    e.preventDefault();
    guardarTurno();
  });
  $("btn-cancelar-edicion").addEventListener("click", cancelarEdicion);
  $("btn-horarios").addEventListener("click", abrirModal);

  // Mensaje de recordatorio: se guarda apenas se modifica
  $("negocio").addEventListener("input", (e) => {
    datos.negocio = e.target.value;
    guardar();
  });
  $("plantilla").addEventListener("input", (e) => {
    datos.plantilla = e.target.value;
    guardar();
  });

  // Lista de turnos y diálogos
  alClickear("lista", {
    recordar: enviarRecordatorio,
    cobrar: cobrarTurno,
    confirmar: (id) => cambiarEstado(id, "confirmado"),
    cancelar: (id) => cambiarEstado(id, "cancelado"),
    ausente: (id) => cambiarEstado(id, "ausente"),
    editar: editarTurno,
    borrar: borrarTurno,
  });
  alClickear("modal-grilla", { horario: (_, dataset) => elegirHorario(dataset.hora) });
  alClickear("elegir-lista", {
    servicio: (servicioId) => cobrarConServicio(turnoACobrarId, servicioId),
  });
  alClickear("cfg-servicios", {
    "precio-servicio": cambiarPrecioServicio,
    "borrar-servicio": borrarServicio,
  });
  alClickear("panel-lista", {
    "precio-corte": cambiarPrecioCorte,
    "borrar-corte": borrarCorte,
  });

  $("modal-fecha").addEventListener("change", dibujarGrilla);
  $("btn-cerrar-modal").addEventListener("click", () => $("modal-horarios").close());

  // Caja
  $("btn-panel").addEventListener("click", abrirPanel);
  $("btn-cerrar-panel").addEventListener("click", () => $("panel-caja").close());
  $("panel-modo").addEventListener("change", dibujarPanel);
  $("panel-fecha").addEventListener("change", dibujarPanel);
  $("form-corte").addEventListener("submit", (e) => {
    e.preventDefault();
    agregarCorteManual();
  });
  $("btn-config").addEventListener("click", abrirConfig);

  // Configuración
  $("btn-guardar-config").addEventListener("click", guardarConfig);
  $("btn-cancelar-config").addEventListener("click", () => $("modal-config").close());
  $("form-servicio").addEventListener("submit", (e) => {
    e.preventDefault();
    agregarServicio();
  });
  $("cfg-porcentaje").addEventListener("keydown", (e) => {
    if (e.key === "Enter") guardarConfig();
  });
  // Si se cierra la configuración (con Guardar, Cerrar o Esc), el panel se actualiza
  $("modal-config").addEventListener("close", () => {
    if ($("panel-caja").open) dibujarPanel();
  });

  // Elegir servicio, confirmar y precio
  $("btn-elegir-cancelar").addEventListener("click", () => $("modal-elegir").close());
  $("modal-elegir").addEventListener("close", () => {
    turnoACobrarId = null;
  });
  $("btn-confirmar-no").addEventListener("click", () => $("modal-confirmar").close());
  $("btn-confirmar-si").addEventListener("click", () => {
    const accion = accionConfirmada;
    accionConfirmada = null;
    $("modal-confirmar").close();
    if (accion) accion();
  });
  $("modal-confirmar").addEventListener("close", () => {
    accionConfirmada = null;
  });
  $("form-precio").addEventListener("submit", (e) => {
    e.preventDefault();
    guardarPrecioPedido();
  });
  $("btn-precio-cancelar").addEventListener("click", () => $("modal-precio").close());
  $("modal-precio").addEventListener("close", () => {
    accionPrecio = null;
  });

  // Historial
  $("btn-historial").addEventListener("click", abrirHistorial);
  $("btn-cerrar-historial").addEventListener("click", () => $("modal-historial").close());
  $("hist-buscar").addEventListener("input", dibujarHistorial);

  // Tocar el fondo oscuro cierra el diálogo
  // (no en configuración ni precio, para no perder lo que se está escribiendo)
  ["modal-horarios", "panel-caja", "modal-elegir", "modal-confirmar", "modal-historial"].forEach(
    (id) => {
      const dialogo = $(id);
      dialogo.addEventListener("click", (e) => {
        if (e.target !== dialogo) return;
        const r = dialogo.getBoundingClientRect();
        const dentro =
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom;
        if (!dentro) dialogo.close();
      });
    },
  );

  setInterval(refrescarSiHaceFalta, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refrescarSiHaceFalta();
  });

  dibujarLista();
}

iniciar();
