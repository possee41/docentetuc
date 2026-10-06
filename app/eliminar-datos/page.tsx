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
    <p className="mt-4 text-base leading-7">Podés solicitar la eliminación de tus datos de DocenteTuc desde esta página, aunque ya no tengas la aplicación instalada. La solicitud no ejecuta un borrado automático: soporte verifica la titularidad y luego elimina los registros correspondientes.</p>
    <a href={mailto} className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-[#075f9b] px-5 font-bold text-white hover:bg-[#064c7b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#075f9b]">Solicitar eliminación por correo</a>
    <p className="mt-2 text-sm">Contacto directo: <a href={mailto} className="font-bold text-[#075f9b] underline">{email}</a></p>
    <div className="mt-8 space-y-7 text-[15px] leading-7">
      <section><h2 className="text-xl font-black">Cómo hacer la solicitud</h2><ol className="mt-2 list-decimal space-y-2 pl-6"><li>Escribí a {email} con el asunto «Solicitud de eliminación de datos — DocenteTuc».</li><li>Si aún podés entrar a DocenteTuc, abrí Perfil → Privacidad → «Eliminar mis datos». Esa opción prepara un correo con una referencia de tu perfil. La referencia ayuda a localizar datos, pero no demuestra por sí sola que seas su titular.</li><li>Si ya no tenés la app, indicá el correo previamente asociado a tu perfil, si lo había, y que necesitás ayuda para identificar tu instalación. Soporte te pedirá la mínima información no pública necesaria para verificar la titularidad. No envíes contraseñas ni documentos de identidad en el primer correo.</li><li>Una vez verificada, soporte ejecutará el borrado y te confirmará el resultado. Si no es posible comprobar la titularidad, no se borrarán datos de otra persona.</li></ol></section>
      <section><h2 className="text-xl font-black">Qué se elimina</h2><p className="mt-2">Los datos personales vinculados a tu identidad en DocenteTuc: perfil y preferencias docentes, perfil público, sesiones y vinculación, guardados, agenda y notas, seguimiento de designaciones, recordatorios, notificaciones, suscripciones y preferencias push, y registros técnicos de límites de uso. Si participaste en Comunidad, también se eliminan tus publicaciones y comentarios, los reportes que enviaste, tus bloqueos, la aceptación de normas y tu rol de moderación. La auditoría de acciones sobre contenido de otras personas pierde el identificador de tu cuenta; no conserva tu email ni una copia de tus publicaciones eliminadas. Esto no elimina tu cuenta Google. Tras la confirmación, también podés borrar la copia local desde Perfil o desde la configuración del navegador.</p></section>
      <section><h2 className="text-xl font-black">Qué no se elimina</h2><p className="mt-2">No se borran las publicaciones ni documentos públicos de organismos educativos, el contenido de Comunidad de otras personas ni las cuentas de SIME, FDCI y demás sitios externos. DocenteTuc no administra esas cuentas. Los mensajes de soporte podrán mantenerse el tiempo necesario para tramitar y documentar la solicitud; el proveedor de correo aplica sus propias políticas.</p></section>
      <section><h2 className="text-xl font-black">Importante</h2><p className="mt-2">Borrar los datos del navegador o desinstalar la app no elimina automáticamente los datos de D1. Conservá tu identificador local hasta que soporte confirme el borrado. DocenteTuc no crea una cuenta propia con contraseña; usa una identidad técnica de instalación y, cuando corresponde, recibe datos de una integración de cuenta. Consultá la <Link href="/privacidad" className="font-bold text-[#075f9b] underline">Política de Privacidad</Link>.</p></section>
    </div>
  </article></main>;
}
