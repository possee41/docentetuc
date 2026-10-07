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
          <p className="mt-3 text-sm text-[#315d7a]">Última actualización: 6 de octubre de 2026</p>
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
            <p className="mt-2">Al usar DocenteTuc se genera un identificador para reconocer esta instalación. Si elegís «Continuar con Google», Google puede compartir datos básicos de identidad y perfil, como el identificador de la cuenta, correo, nombre e imagen. El inicio ocurre en la pantalla oficial de Google: DocenteTuc no solicita ni recibe tu contraseña. Para administrar tu cuenta y sesión, DocenteTuc guarda de forma privada el correo, nombre, imagen y un identificador interno. Los datos técnicos temporales usados durante el inicio no quedan guardados como credenciales de acceso. Este acceso solo solicita datos básicos de identidad: no pedimos permiso para Gmail, Drive, Calendar, contactos, archivos privados ni ubicación.</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>los datos de tu Perfil docente privado —nombre y preferencias de niveles, áreas, cargos, juntas, carácter, circuitos, turnos, departamento, localidad e intereses— para personalización y compatibilidad; no se muestran en Comunidad;</li>
              <li>si configurás «Mi perfil público» y participás en Comunidad, el nombre visible, el avatar que elegiste y la biografía opcional. La foto de Google es privada y no reemplaza ni se publica como ese avatar;</li>
              <li>si participás en Comunidad, tus publicaciones y comentarios de texto, la aceptación de las normas, reportes y bloqueos; quienes moderan pueden ver el contenido reportado, su motivo y el perfil público necesario, pero no tu correo Google, foto privada ni Perfil docente;</li>
              <li>tus publicaciones guardadas, seguimiento de designaciones, eventos, notas y recordatorios de agenda. «Guardadas» es privada: no es un «Me gusta», no tiene contador público y otros usuarios no ven qué guardaste;</li>
              <li>preferencias y registro de alertas y notificaciones;</li>
              <li>si activás notificaciones push, datos técnicos de la suscripción y preferencias necesarios para enviar los avisos.</li>
            </ul>
            <p className="mt-2">También se usa un identificador técnico para limitar solicitudes y ayudar a proteger el servicio. No pedimos ni almacenamos contraseñas de SIME, FDCI, INFoD ni otros portales externos.</p>
          </section>

          <section aria-labelledby="finalidad">
            <h2 id="finalidad" className="text-xl font-black">3. Para qué usamos los datos</h2>
            <p className="mt-2">Para mostrar oportunidades relacionadas con tus preferencias, organizar designaciones y capacitaciones, conservar guardados y agenda, generar recordatorios y alertas, responder consultas en DocenteTuc IA, permitir conversaciones docentes en Comunidad cuando esté habilitada y mantener el funcionamiento y la seguridad del servicio.</p>
          </section>

          <section aria-labelledby="ia">
            {/* RELEASE GATE: confirmar proveedor y condiciones efectivas de conservación/entrenamiento antes del lanzamiento; no afirmarlos sin evidencia. */}
            <h2 id="ia" className="text-xl font-black">4. DocenteTuc IA</h2>
            <p className="mt-2">Cuando enviás una consulta, su texto y hasta seis mensajes recientes pasan por nuestro servidor y se envían a un servicio externo de inteligencia artificial configurado para generar la respuesta. También pueden enviarse fragmentos pertinentes de publicaciones sincronizadas por DocenteTuc. Si activás «Usar mi perfil docente», se incorporan preferencias del perfil para personalizar esa respuesta. Para consultas sobre agenda o seguimiento, pueden agregarse únicamente las entradas pertinentes. DocenteTuc no agrega al pedido tu correo ni foto de Google, ni identificadores internos de cuenta o instalación.</p>
            <p className="mt-2">Las fuentes que aparecen en la respuesta proceden de información sincronizada por DocenteTuc; el asistente no navega libremente por Internet. Las respuestas pueden contener errores: para fechas, normas, designaciones, inscripciones y otros datos que cambian, revisá la fuente oficial indicada.</p>
            <p className="mt-2">La conversación permanece en la interfaz mientras la usás y no se guarda como historial permanente de chat de DocenteTuc. Para consultas generales sin historial, perfil autorizado ni contexto de una publicación, el servicio conserva en memoria la pregunta, la respuesta y sus fuentes. Puede reutilizar esa respuesta durante cinco minutos; después no vuelve a servirla, aunque la entrada puede permanecer temporalmente en memoria hasta que se reemplace o se libere la instancia del servicio. La caché está separada por cuenta o instalación y no se guarda en la base de datos de DocenteTuc. El servicio externo puede tratar las consultas según sus propias condiciones y DocenteTuc no controla su conservación. No escribas contraseñas ni datos sensibles innecesarios.</p>
          </section>

          <section aria-labelledby="push">
            <h2 id="push" className="text-xl font-black">5. Notificaciones push</h2>
            <p className="mt-2">Si las activás, guardamos en nuestros servidores los datos técnicos de la suscripción y tus preferencias para enviar avisos mediante el servicio push del navegador o dispositivo. Podés desactivarlas en Perfil o en la configuración del navegador. Al desactivarlas desde la app, la suscripción queda inactiva; su registro histórico no se elimina automáticamente.</p>
          </section>

          <section aria-labelledby="almacenamiento">
            <h2 id="almacenamiento" className="text-xl font-black">6. Almacenamiento y conservación</h2>
            <p className="mt-2">El navegador guarda localmente el tema, un identificador de esta instalación, una copia reciente de datos para cargar la app —que puede incluir Perfil docente, Perfil público y agenda—, una selección pendiente de designación y una caché del clima. También conserva recursos para facilitar el uso sin conexión. En los servidores de Cloudflare se almacenan por separado tu Perfil docente privado y Perfil público, así como preferencias, guardados, seguimiento, agenda, recordatorios, notificaciones y, si participás en Comunidad, publicaciones, comentarios, normas aceptadas, reportes, bloqueos y datos de moderación.</p>
            <p className="mt-2">Los contenidos ocultos se conservan para revisión hasta 90 días desde la última acción de moderación; al vencer ese plazo se elimina el texto y se desvincula el contenido de la auditoría. Un contenido retirado de forma definitiva se reemplaza inmediatamente por un aviso y no se conserva su texto original. La auditoría interna puede conservar tipo de contenido, acción, motivo, fecha e identificador de quien moderó mientras su cuenta siga activa; al eliminar esa cuenta se quita esa asociación. No existe un plazo único de borrado automático para todos los demás datos. Borrar los datos del navegador no elimina por sí solo los datos guardados en el servidor.</p>
          </section>

          <section aria-labelledby="terceros">
            <h2 id="terceros" className="text-xl font-black">7. Servicios de terceros</h2>
            <p className="mt-2">Utilizamos Cloudflare para alojar la aplicación y guardar datos; Google para el inicio de sesión; el proveedor de IA configurado (Google Gemini u OpenAI); y el servicio push del navegador o dispositivo si activás avisos. Inicio consulta Open-Meteo directamente para una ubicación fija de Tucumán: envía coordenadas de referencia y no solicita ni transmite la ubicación GPS del teléfono. Como en cualquier conexión, los servicios externos pueden recibir la dirección de red y metadatos técnicos necesarios para responder; su uso y conservación dependen de sus propias prácticas. Si abrís una fuente educativa o enlace externo, ese sitio aplica sus propias prácticas de privacidad.</p>
            <p className="mt-2 text-xs text-[var(--text-muted)]">Crédito meteorológico: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#075f9b] underline">Open-Meteo</a>. DocenteTuc adapta los datos a un resumen de temperatura y condición actual para Tucumán. Licencia: <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#075f9b] underline">CC BY 4.0</a>.</p>
            <p className="mt-2">La app no incluye publicidad ni analítica de terceros. Usa una cookie funcional para recordar si el menú lateral está abierto. Las instalaciones nuevas también usan una credencial técnica aleatoria en cookies HttpOnly para comprobar que la instalación actual es propia; su representación derivada se guarda en el servidor. No es visible para JavaScript ni se envía a la Comunidad. Ninguna de estas cookies se usa para publicidad.</p>
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
            <p className="mt-2">Desde Cuenta podés confirmar «ELIMINAR» para borrar tu identidad DocenteTuc y los datos asociados a la cuenta, incluidos perfil docente y público, sesiones, guardados, agenda, recordatorios, preferencias y suscripciones push, y tus publicaciones, comentarios, reportes, bloqueos y aceptación de normas de Comunidad. No elimina tu cuenta Google. Los datos de instalaciones vinculadas también se incluyen. En instalaciones nuevas protegidas, si eliminás la cuenta desde esa misma instalación y la credencial privada sigue disponible, se borran además sus datos separados. Los datos separados de otras instalaciones no vinculadas no se eliminan al borrar la cuenta desde otro dispositivo: borrá cada instalación protegida desde ese mismo dispositivo mientras conserve su credencial. Las instalaciones heredadas sin credencial segura —o aquellas cuya cookie de protección se perdió— pueden conservar datos separados que no se borran con la cuenta; contactá soporte si necesitás ayuda. Si usás DocenteTuc sin Google en una instalación protegida, podés eliminar únicamente sus propios datos desde Cuenta → «Eliminar los datos de este dispositivo». Los comentarios de otras personas en publicaciones tuyas se eliminan con ellas; el contenido de otras personas permanece. Las auditorías ligadas al contenido eliminado se borran; en las demás acciones se conserva un registro interno acotado, sin asociación a la cuenta una vez eliminada.</p>
            <p className="mt-2">La eliminación de DocenteTuc no elimina tu cuenta Google, no requiere conocer tu contraseña Google y no elimina cuentas de SIME, FDCI u otros sitios. Tampoco borra registros técnicos que puedan conservar Cloudflare o un proveedor externo, correos de soporte ni copias locales de otros dispositivos. La página <Link className="font-bold text-[#075f9b] underline" href="/eliminar-datos">Eliminar mis datos</Link> explica cómo iniciar una solicitud externa si no podés entrar a tu cuenta. Para consultas, escribí a <a className="font-bold text-[#075f9b] underline" href={`mailto:${contact}?subject=Privacidad%20DocenteTuc`}>{contact}</a>. No envíes contraseñas.</p>
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
