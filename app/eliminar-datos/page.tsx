import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Solicitar eliminación de datos | DocenteTuc",
  description: "Cómo solicitar la eliminación de tus datos personales de DocenteTuc sin instalar la aplicación.",
};

const email = "soporte.docentetuc@gmail.com";
const mailto = `mailto:${email}?subject=${encodeURIComponent("Solicitud de eliminación de datos — DocenteTuc")}`;

export default function DeleteDataPage() {
  return <main className="min-h-svh bg-[#f3f8fd] px-4 py-8 text-[#062b55] sm:px-6 sm:py-12"><article className="mx-auto max-w-3xl rounded-3xl border border-[#c8ddeb] bg-white p-5 shadow-sm sm:p-9">
    <Link href="/" className="text-sm font-bold text-[#075f9b] underline underline-offset-4">← Volver a DocenteTuc</Link>
    <p className="mt-6 text-xs font-black uppercase tracking-[.18em] text-[#0878be]">Privacidad · DocenteTuc</p>
    <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">Eliminar mis datos</h1>
    <p className="mt-4 text-base leading-7">Si todavía podés iniciar sesión, podés eliminar directamente tu cuenta y los datos asociados desde Cuenta → «Eliminar cuenta y datos DocenteTuc». Si ya no tenés acceso, iniciá una solicitud desde esta página por correo: soporte verificará la titularidad y te responderá antes de tramitar el borrado.</p>
    <a href={mailto} className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-[#075f9b] px-5 font-bold text-white hover:bg-[#064c7b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075f9b]">Solicitar eliminación por correo</a>
    <p className="mt-2 text-sm">Contacto directo: <a href={mailto} className="font-bold text-[#075f9b] underline">{email}</a></p>
    <div className="mt-8 space-y-7 text-[15px] leading-7">
      <section><h2 className="text-xl font-black">Cómo hacer la solicitud</h2><ol className="mt-2 list-decimal space-y-2 pl-6"><li>Si no podés iniciar sesión, escribí a {email} con el asunto «Solicitud de eliminación de datos — DocenteTuc».</li><li>Indicá el correo que usabas para iniciar sesión con Google, si lo recordás, y que necesitás eliminar tu cuenta DocenteTuc. Soporte puede pedir únicamente la información adicional mínima para comprobar que la solicitud es tuya.</li><li>No envíes tu contraseña de Google ni de otros servicios. No envíes documentos de identidad en el primer mensaje.</li><li>La solicitud por correo no borra nada de forma automática: soporte verifica la titularidad, confirma el alcance y te informa el resultado. No se borrarán datos de otra persona si no puede verificarse que te pertenecen.</li></ol></section>
      <section><h2 className="text-xl font-black">Qué elimina la opción dentro de DocenteTuc</h2><p className="mt-2">Al confirmar la eliminación dentro de tu cuenta se borran la cuenta e identidad de DocenteTuc, sus sesiones y vínculo con Google; los perfiles docente y público; preferencias, guardados, agenda, seguimientos, recordatorios, notificaciones y suscripciones push; y, si participaste en Comunidad, tus publicaciones y comentarios, los reportes que enviaste, bloqueos, aceptación de normas y permisos de moderación. También se borra la copia local de DocenteTuc del dispositivo desde el que confirmás. Los comentarios de otras personas en tus publicaciones se eliminan junto con ellas. Las acciones de moderación que sigan vinculadas a contenido de terceros quedan sin asociación a tu cuenta.</p></section>
      <section><h2 className="text-xl font-black">Datos de una instalación no vinculada</h2><p className="mt-2">Las instalaciones nuevas protegidas pueden borrar sus propios datos sin Google desde Cuenta → «Eliminar los datos de este dispositivo». Si eliminás tu cuenta desde esa misma instalación y la credencial privada sigue disponible, también se borran sus datos separados. Los datos separados de otras instalaciones no vinculadas no se eliminan al borrar la cuenta desde otro dispositivo: borrá cada instalación protegida desde ese mismo dispositivo mientras conserve su credencial. Las instalaciones heredadas no tienen esa prueba criptográfica y no se borran utilizando solo el identificador; si se pierde la cookie de protección, tampoco podemos verificar la instalación actual. En esos casos los datos pueden quedar separados: escribí a soporte.docentetuc@gmail.com para solicitar ayuda. Esta limitación también se explica en la <Link href="/privacidad" className="font-bold text-[#075f9b] underline">Política de Privacidad</Link>.</p></section>
      <section><h2 className="text-xl font-black">Qué no se elimina</h2><p className="mt-2">Eliminar tu cuenta DocenteTuc no elimina tu cuenta Google y DocenteTuc no necesita conocer tu contraseña Google. No se borran publicaciones ni documentos públicos de organismos, contenido de Comunidad de otras personas, cuentas de SIME/FDCI/INFoD, registros técnicos que conserven proveedores externos, correos de soporte ni copias locales de DocenteTuc en otros dispositivos. Los mensajes de soporte podrán mantenerse el tiempo necesario para tramitar la solicitud.</p></section>
      <section><h2 className="text-xl font-black">Importante</h2><p className="mt-2">Borrar los datos del navegador o desinstalar la app no elimina automáticamente los datos guardados en el servidor. La vía por correo está disponible aunque ya no tengas la aplicación. Consultá la <Link href="/privacidad" className="font-bold text-[#075f9b] underline">Política de Privacidad</Link> para conocer el tratamiento completo.</p></section>
    </div>
  </article></main>;
}
