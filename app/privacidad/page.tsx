import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de Privacidad de DocenteTuc",
  description: "Cómo DocenteTuc trata los datos de quienes usan la aplicación.",
};

const contact = "soporte.docentetuc@gmail.com";

export default function PrivacyPage() {
  return (
    <main className="min-h-svh bg-[#f3f8fd] px-4 py-8 text-[#062b55] sm:px-6 sm:py-12">
      <article className="mx-auto max-w-3xl rounded-3xl border border-[#c8ddeb] bg-white p-5 shadow-sm sm:p-9">
        <Link href="/" className="text-sm font-bold text-[#075f9b] underline underline-offset-4">← Volver a DocenteTuc</Link>
        <header className="mt-6 border-b border-[#d9e8f2] pb-6">
          <p className="text-xs font-black uppercase tracking-[.18em] text-[#0878be]">DocenteTuc</p>
          <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">Política de Privacidad de DocenteTuc</h1>
          <p className="mt-3 text-sm text-[#315d7a]">Última actualización: 5 de octubre de 2026</p>
          <p className="mt-5 rounded-2xl border border-[#9fc9e3] bg-[#eaf6fd] p-4 font-bold leading-relaxed">
            DocenteTuc es una aplicación independiente y no representa al Gobierno de Tucumán, al Ministerio de Educación de Tucumán ni a ningún organismo público.
          </p>
        </header>

        <div className="space-y-8 pt-7 text-[15px] leading-7">
          <section aria-labelledby="sobre">
            <h2 id="sobre" className="text-xl font-black">1. Sobre DocenteTuc</h2>
            <p className="mt-2">DocenteTuc facilita el acceso y la organización de información de interés para docentes de Tucumán, Argentina. Reúne datos de fuentes públicas y oficiales y enlaza los originales para que puedas verificarlos. No sustituye las publicaciones ni los trámites de esos organismos.</p>
          </section>

          <section aria-labelledby="datos">
            <h2 id="datos" className="text-xl font-black">2. Información que tratamos</h2>
            <p className="mt-2">Al abrir la aplicación se genera un identificador de esta instalación. Si accedés mediante una integración de cuenta, también podemos recibir su identificador, nombre y correo electrónico. Según las funciones que uses, tratamos:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>nombre y preferencias del perfil docente: niveles, áreas, materias, cargos, juntas, carácter, circuitos, turnos, departamento, localidad e intereses de capacitación;</li>
              <li>si configurás «Mi perfil público» y participás en Comunidad, el nombre visible, uno de los avatares y la bio opcional pueden mostrarse junto a tus publicaciones y comentarios; el email de Google, los identificadores internos y el perfil docente privado no se muestran;</li>
              <li>si participás en Comunidad, tus publicaciones y comentarios de texto, la aceptación versionada de las normas, reportes, bloqueos y registros internos de moderación necesarios para operar el espacio;</li>
              <li>publicaciones guardadas, seguimiento de designaciones, eventos, notas y recordatorios de agenda;</li>
              <li>preferencias y registro de alertas y notificaciones;</li>
              <li>si activás push, identificador del dispositivo, dirección de suscripción, claves técnicas y agente del navegador necesarios para enviar avisos.</li>
            </ul>
            <p className="mt-2">El servidor también utiliza identificadores técnicos para limitar solicitudes de IA y pruebas de push. No pedimos ni almacenamos contraseñas de SIME, FDCI u otros portales oficiales.</p>
          </section>

          <section aria-labelledby="finalidad">
            <h2 id="finalidad" className="text-xl font-black">3. Para qué usamos los datos</h2>
            <p className="mt-2">Para mostrar oportunidades relacionadas con tus preferencias, organizar designaciones y capacitaciones, conservar guardados y agenda, generar recordatorios y alertas, responder consultas en DocenteTuc IA, permitir conversaciones docentes en Comunidad cuando esté habilitada y mantener el funcionamiento y la seguridad del servicio.</p>
          </section>

          <section aria-labelledby="ia">
            <h2 id="ia" className="text-xl font-black">4. DocenteTuc IA</h2>
            <p className="mt-2">Cuando enviás una consulta, su texto y hasta seis mensajes recientes de la conversación pasan por nuestro servidor y se envían al proveedor de IA configurado, junto con el contexto necesario para responder. El código admite Google Gemini u OpenAI; el proveedor activo depende de la configuración del servidor. Ese contexto puede incluir publicaciones recuperadas. Si preguntás por tu agenda o seguimiento de designaciones, puede incluir las entradas personales pertinentes. Los datos generales de tu perfil docente se incorporan sólo si activás la opción «Usar mi perfil docente». El UUID de instalación, correo y `user_id` no se incluyen en el cuerpo enviado al proveedor.</p>
            <p className="mt-2">La conversación se mantiene en la memoria de la interfaz mientras la usás; DocenteTuc no la guarda como historial de chat en D1. Algunas consultas genéricas sin perfil ni historial pueden tener su respuesta en memoria del Worker por hasta cinco minutos. El proveedor de IA puede tratar la consulta conforme a sus propias condiciones; DocenteTuc no controla su retención externa. No escribas contraseñas, datos financieros ni otra información sensible innecesaria.</p>
          </section>

          <section aria-labelledby="push">
            <h2 id="push" className="text-xl font-black">5. Notificaciones push</h2>
            <p className="mt-2">Si las activás, guardamos en D1 los datos técnicos de la suscripción y tus preferencias para enviar avisos mediante el servicio push del navegador o dispositivo. Podés desactivarlas en Perfil o en la configuración del navegador. Al desactivarlas desde la app, la suscripción queda marcada como inactiva en el servidor; no se elimina automáticamente su registro histórico.</p>
          </section>

          <section aria-labelledby="almacenamiento">
            <h2 id="almacenamiento" className="text-xl font-black">6. Almacenamiento y conservación</h2>
            <p className="mt-2">El navegador guarda localmente el tema, un identificador de dispositivo, una copia de la última respuesta de la app —que puede incluir tu perfil, perfil público y agenda—, una selección pendiente de designación y una caché del clima. El service worker conserva recursos de la aplicación para facilitar el uso sin conexión. D1, alojada en Cloudflare, almacena por separado el perfil docente privado (`profiles`) y el perfil público opcional (`public_profiles`), además de preferencias, guardados, seguimiento, agenda, recordatorios, notificaciones, suscripciones push y, si participás en Comunidad, publicaciones, comentarios, aceptación de normas, reportes, bloqueos y metadatos de moderación.</p>
            <p className="mt-2">No hay un plazo fijo de borrado automático para todos esos datos. El contenido oculto o retirado de Comunidad puede conservarse internamente para revisión durante un máximo de 90 días desde la última acción de moderación; después se elimina el texto y se conserva únicamente la auditoría mínima de acción, motivo y fecha. Los contadores de límites tienen vencimiento funcional, pero no se acredita una purga automática de todas esas filas. Borrar los datos del navegador no elimina por sí solo los registros del servidor.</p>
          </section>

          <section aria-labelledby="terceros">
            <h2 id="terceros" className="text-xl font-black">7. Servicios de terceros</h2>
            <p className="mt-2">Utilizamos Cloudflare para alojar la aplicación y D1; el proveedor de IA configurado en el servidor (el código admite Google Gemini u OpenAI); y el servicio push del navegador o dispositivo para las notificaciones. La pantalla de Inicio consulta Open-Meteo directamente desde el navegador para mostrar el clima de una ubicación fija de Tucumán: envía coordenadas fijas de referencia, no solicita tu ubicación GPS, UUID ni perfil. Como en cualquier conexión HTTP, el proveedor y los intermediarios pueden recibir IP y metadatos técnicos de red; sus usos y plazos dependen de sus propias prácticas. Si abrís una fuente oficial, un mapa o un enlace externo, ese sitio puede aplicar sus propias prácticas de privacidad.</p>
            <p className="mt-2 text-xs text-[var(--text-muted)]">Crédito meteorológico: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#075f9b] underline">Open-Meteo</a>. DocenteTuc adapta los datos a un resumen de temperatura y condición actual para Tucumán. Licencia: <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#075f9b] underline">CC BY 4.0</a>.</p>
            <p className="mt-2">El código actual no incluye un SDK de publicidad ni de analítica. La app utiliza una cookie funcional llamada <code className="rounded bg-[#eaf6fd] px-1">sidebar_state</code> al cambiar el estado del menú lateral; no se usa para publicidad.</p>
          </section>

          <section aria-labelledby="fuentes">
            <h2 id="fuentes" className="text-xl font-black">8. Fuentes oficiales de información educativa</h2>
            <p className="mt-2">DocenteTuc consulta, organiza o enlaza información pública de las siguientes fuentes utilizadas por el proyecto:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6 [&_a]:font-semibold [&_a]:text-[#075f9b] [&_a]:underline">
              <li><a href="https://sime.educaciontuc.gov.ar/Vacantes/Index">SIME — vacantes y designaciones</a></li>
              <li><a href="https://capacitaciondocente.educaciontuc.gov.ar/">Capacitación Docente (FDCI)</a></li>
              <li><a href="https://cenet.inet.edu.ar/mod/page/view.php?id=30493">CeNET / INET</a></li>
              <li><a href="https://red.infd.edu.ar/cursos-nacionales-2/">INFoD — catálogo público de cursos</a></li>
              <li><a href="https://padrones.educaciontuc.gov.ar/">Padrones, comunicados y llamados abiertos de Tucumán</a></li>
              <li><a href="https://www.educaciontuc.gov.ar/a/ministerio/">Ministerio de Educación de Tucumán — información pública</a></li>
            </ul>
            <p className="mt-2">Algunos documentos públicos pueden incluir datos personales que fueron publicados por los organismos responsables. La disponibilidad, exactitud y actualización de estos contenidos también depende de las fuentes originales. DocenteTuc conserva el enlace oficial cuando corresponde y no modifica el carácter de sus documentos.</p>
          </section>

          <section aria-labelledby="seguridad">
            <h2 id="seguridad" className="text-xl font-black">9. Seguridad</h2>
            <p className="mt-2">Aplicamos medidas técnicas razonables para proteger la información, como conexiones HTTPS y validación de solicitudes. Ningún sistema puede garantizar seguridad absoluta.</p>
          </section>

          <section aria-labelledby="control">
            <h2 id="control" className="text-xl font-black">10. Control y eliminación de datos</h2>
            <p className="mt-2">Desde Perfil podés confirmar «ELIMINAR» para borrar tu cuenta e identidad de DocenteTuc. Esto elimina perfil docente y público, sesiones y vínculo de autenticación de DocenteTuc; no elimina tu cuenta Google. También se eliminan tus publicaciones y comentarios de Comunidad, los reportes que presentaste, bloqueos en cualquiera de las dos direcciones, aceptación de normas y permisos de moderación. Reportes y auditoría ligados a contenido que se elimina se borran en cascada; en eventos sobre contenido de otras personas se quita el identificador de quien moderó y se conservan únicamente acción, motivo y fecha. El contenido de otras personas permanece. Esto no elimina automáticamente registros de infraestructura de Cloudflare, datos que retenga un proveedor externo ni correos de soporte. También podés iniciar una solicitud desde <Link className="font-bold text-[#075f9b] underline" href="/eliminar-datos">Eliminar mis datos</Link>; soporte verificará la titularidad antes de cualquier borrado manual.</p>
            <p className="mt-2">Los datos de otras personas y las cuentas de portales oficiales no se eliminan. Los correos necesarios para tramitar una solicitud se gestionan por separado. Si no podemos verificar la titularidad, no ejecutaremos un borrado que pudiera afectar a otra persona. Para consultas, escribí a <a className="font-bold text-[#075f9b] underline" href={`mailto:${contact}?subject=Privacidad%20DocenteTuc`}>{contact}</a>. No envíes contraseñas.</p>
          </section>

          <section aria-labelledby="menores">
            <h2 id="menores" className="text-xl font-black">11. A quién está dirigida</h2>
            <p className="mt-2">DocenteTuc está orientada a docentes y profesionales de la educación; no está diseñada específicamente para menores.</p>
          </section>

          <section aria-labelledby="cambios">
            <h2 id="cambios" className="text-xl font-black">12. Cambios en esta política</h2>
            <p className="mt-2">Podemos actualizar esta política si cambian las funciones o los servicios utilizados. La fecha de actualización se muestra al comienzo.</p>
          </section>

          <section aria-labelledby="contacto">
            <h2 id="contacto" className="text-xl font-black">13. Contacto sobre privacidad</h2>
            <p className="mt-2">Para consultas o solicitudes relativas a tus datos en DocenteTuc: <a className="font-bold text-[#075f9b] underline" href={`mailto:${contact}?subject=Privacidad%20DocenteTuc`}>{contact}</a>.</p>
          </section>
        </div>
      </article>
    </main>
  );
}
