export type UsefulMetadata = {
  recordType: "organization" | "procedure" | "system";
  services?: string[]; requirements?: string[]; documents?: string[]; aliases?: string[];
  address?: string; phones?: string[]; emails?: string[]; openingHours?: string;
  parentOrganization?: string; access?: "public" | "private"; lastVerified: string;
  sourceStatus?: "verified" | "partial"; notes?: string; discrepancy?: string;
};

export type UsefulRecord = {
  id: string; title: string; category: string; summary: string; officialUrl: string; metadata: UsefulMetadata;
};

const verified = "2026-09-27";

export const usefulInformation: UsefulRecord[] = [
  {
    id: "novedades-salariales", title: "Dirección de Novedades Salariales", category: "Sueldo y haberes",
    summary: "Interviene en novedades y procesos de liquidación de haberes docentes. La Guía de Trámites SIME publica gestiones de nombramientos, cambios de carácter, ascensos y salario familiar.",
    officialUrl: "https://www.educaciontuc.gov.ar/a/ministerio/",
    metadata: { recordType: "organization", services: ["Liquidación de sueldos", "Novedades salariales", "Bloqueo de haberes", "Salario familiar", "Nombramientos y cambios de situación"], phones: ["0381 430-3970"], parentOrganization: "Ministerio de Educación de Tucumán", aliases: ["no cobré", "no cobre", "me pagaron mal", "me liquidaron mal", "reclamo de haberes", "liquidación", "adicionales", "complementos", "boleta de sueldo"], lastVerified: verified, sourceStatus: "verified", notes: "La fuente institucional no publica correo, dirección propia ni horario específico para esta Dirección." }
  },
  {
    id: "direccion-personal", title: "Dirección de Personal", category: "Personal docente",
    summary: "Gestiona legajos y trámites administrativos del personal educativo. La Guía de Trámites SIME publica procedimientos, documentación y formularios.",
    officialUrl: "https://sime.educaciontuc.gov.ar/GuiaTramites/GuiaTramites/DocumentosTramites?ret=landing&tramite_id=23",
    metadata: { recordType: "organization", services: ["Confección de legajo", "Situación administrativa", "Documentación del personal"], address: "Av. Salta 851, San Miguel de Tucumán", phones: ["0381 421-8474", "0381 431-2133"], emails: ["dirpersonal@educaciontuc.gov.ar"], openingHours: "Lunes a viernes de 08:00 a 17:00", parentOrganization: "Ministerio de Educación de Tucumán", aliases: ["legajo", "personal", "foja de servicios", "situación de revista"], lastVerified: verified, discrepancy: "La Guía de Trámites publica 0381 421-8474; el directorio del Ministerio publica 0381 431-2133. Se conservan ambos como fuentes oficiales sin elegir uno silenciosamente." }
  },
  {
    id: "legajo", title: "Confección de legajo por primera vez", category: "Trámites",
    summary: "Trámite presencial y gratuito para personal docente y categorizado del Ministerio de Educación.",
    officialUrl: "https://sime.educaciontuc.gov.ar/GuiaTramites/GuiaTramites/DocumentosTramites?ret=landing&tramite_id=23",
    metadata: { recordType: "procedure", address: "Av. Salta 851, San Miguel de Tucumán", phones: ["0381 421-8474"], emails: ["dirpersonal@educaciontuc.gov.ar"], openingHours: "Lunes a viernes de 08:00 a 17:00", parentOrganization: "Dirección de Personal", requirements: ["DNI (copia de ambos lados)", "Actas de nacimiento y matrimonio actualizadas, cuando corresponda", "Títulos secundario, terciario y universitario, según corresponda", "Certificado de antecedentes actualizado", "Certificado de residencia F.2000/A", "Turno y certificado de aptitud física de SESOP", "Constancia de CUIL", "Certificado de afiliación al Subsidio de Salud", "Propuesta de Junta para personal docente", "Instrumento de designación y acta de toma de posesión", "Declaración jurada de cargos", "Formulario de confección de legajo por triplicado"], aliases: ["hacer mi legajo", "papeles legajo", "documentación legajo", "ingreso docente"], lastVerified: verified }
  },
  {
    id: "digituc", title: "DigiTUC — Boletas digitales", category: "Sueldo y haberes",
    summary: "Sistema privado para consultar recibos de sueldo digitales. DocenteTuc no solicita ni almacena la contraseña. El portal también ofrece verificación pública de recibos.",
    officialUrl: "https://www.digituc.gob.ar/index.php/Controlador_login",
    metadata: { recordType: "system", services: ["Consultar recibos de sueldo", "Verificar un recibo", "Recuperar contraseña"], phones: ["0381 484-4000 interno 476"], openingHours: "Soporte de recuperación: 08:00 a 13:00", access: "private", aliases: ["recibo", "boleta", "mi sueldo", "boleta digital", "recibo de sueldo"], lastVerified: verified, notes: "El acceso personal requiere CUIL y contraseña en el sitio oficial." }
  },
  {
    id: "jubilacion-docente", title: "Inicio de trámite para jubilación docente", category: "Jubilaciones",
    summary: "Presentación de carpeta para iniciar la jubilación. Destinado a docentes y directivos; trámite gratuito.",
    officialUrl: "https://guiadetramites.tucuman.gob.ar/tramite/11450/",
    metadata: { recordType: "procedure", address: "Santa Fe 850, San Miguel de Tucumán", phones: ["0381 421-3742"], openingHours: "Lunes a viernes de 08:00 a 18:00", parentOrganization: "Relevamiento Previsional — Secretaría de Estado de Gestión Educativa", requirements: ["Presentar documentación según el formulario oficial enlazado por la Guía de Trámites"], aliases: ["quiero jubilarme", "jubilación docente", "relevamiento previsional"], lastVerified: verified }
  },
  {
    id: "ciidept", title: "CIIDEPT", category: "CIIDEPT",
    summary: "Centro de Innovación, Investigación y Desarrollo Educativo, Productivo y Tecnológico. Desarrolla propuestas de ciencia y tecnología, laboratorios, proyectos educativos, patrimonio documental y programas como Escuelas Verdes.",
    officialUrl: "https://ciidept.edu.ar/",
    metadata: { recordType: "organization", address: "José Ingenieros 260, San Miguel de Tucumán", phones: ["0381 497-2700"], openingHours: "Lunes a viernes de 08:00 a 18:00", services: ["Laboratorios científicos y tecnológicos", "Propuestas educativas", "Repositorio documental", "Patrimonio documental", "Programa Escuelas Verdes", "Biblioteca pedagógica y CENDIE"], aliases: ["qué oficinas hay en CIIDEPT", "oficinas CIIDEPT", "José Ingenieros 260"], lastVerified: verified, discrepancy: "Páginas antiguas del repositorio también muestran 0381 432-1957. La portada más reciente del repositorio muestra 0381 497-2700." }
  },
  {
    id: "cendie", title: "Centro de Documentación e Información Educativa (CENDIE)", category: "Normativa y documentación",
    summary: "Organismo técnico docente y depositario de documentación educativa, legislación provincial y recursos bibliotecológicos y de archivo. Funciona bajo la órbita del CIIDEPT.",
    officialUrl: "https://www.educaciontuc.gov.ar/a/organismos/centro-de-documentacion-e-informacion-educativa/",
    metadata: { recordType: "organization", address: "José Ingenieros 260, San Miguel de Tucumán", emails: ["cendie@ciidept.edu.ar"], openingHours: "Lunes a viernes de 12:00 a 18:00", parentOrganization: "CIIDEPT", services: ["Documentación educativa", "Legislación educativa provincial", "Biblioteca y archivo", "Asistencia bibliotecológica", "Repositorio digital"], aliases: ["CENDIE", "biblioteca educativa", "legislación", "archivo pedagógico"], lastVerified: verified }
  },
  {
    id: "repositorio-ciidept", title: "Repositorio documental CIIDEPT", category: "Normativa y documentación",
    summary: "Repositorio público de normativa educativa, diseños curriculares, vocabulario técnico, historia e identidad y archivo pedagógico.",
    officialUrl: "https://ciidept.edu.ar/repositorium/BD/index.html",
    metadata: { recordType: "system", address: "José Ingenieros 260, San Miguel de Tucumán", services: ["Normativa educativa", "Diseños curriculares", "Archivo pedagógico", "Vocabulario técnico", "Historia e identidad"], access: "public", aliases: ["resoluciones", "normativa", "materiales oficiales", "repositorio"], lastVerified: verified }
  },
  {
    id: "fdci", title: "Formación Docente Continua e Investigación (FDCI)", category: "Capacitación y FDCI",
    summary: "Evalúa, aprueba, diseña y desarrolla trayectos oficiales de formación. El panel personal permite gestionar inscripciones, aulas y estado de trayectos.",
    officialUrl: "https://capacitaciondocente.educaciontuc.gov.ar/",
    metadata: { recordType: "organization", services: ["Oferta de capacitaciones", "Inscripción", "Aulas virtuales", "Estado de trayectos", "Certificaciones visibles en SIME"], emails: ["soportedigitalfdc@gmail.com"], access: "private", parentOrganization: "Dirección de Educación Superior No Universitaria", aliases: ["FDCI", "oferta FDCI", "aulas FDCI", "capacitación docente"], lastVerified: verified, sourceStatus: "partial", notes: "El correo publicado corresponde a soporte digital. La fuente no publica un teléfono, domicilio, horario ni una oficina específica para reclamos de certificación." }
  },
  {
    id: "certificacion-fdci", title: "Certificación de trayectos FDCI", category: "Títulos y certificados",
    summary: "Para obtener el certificado se debe aprobar el trayecto y mantener actualizada la situación docente en SIME. Las certificaciones se visualizan en SIME.",
    officialUrl: "https://capacitaciondocente.educaciontuc.gov.ar/deberes-y-derechos-fdci",
    metadata: { recordType: "procedure", requirements: ["Trayecto aprobado", "Asistencia requerida", "Trabajos obligatorios aprobados", "Instancias evaluativas aprobadas", "Situación docente actualizada y regularizada en SIME"], emails: ["soportedigitalfdc@gmail.com"], parentOrganization: "FDCI", aliases: ["problemas con mi certificado FDCI", "certificado FDCI", "certificado curso", "no aparece certificado", "retirar certificado", "certificación capacitación"], lastVerified: verified, sourceStatus: "partial", notes: "La fuente no publica un circuito presencial específico para reclamos de certificados; el correo informado es de soporte digital." }
  },
  {
    id: "educacion-superior", title: "Dirección de Educación Superior No Universitaria y Artística", category: "Gestión escolar",
    summary: "Responsable de formación docente inicial y continua, tecnicaturas superiores, educación artística y apoyo pedagógico a escuelas.",
    officialUrl: "https://www.educaciontuc.gov.ar/a/direcciones/educacion-superior-y-artistica/",
    metadata: { recordType: "organization", address: "Av. Sarmiento 850, San Miguel de Tucumán", phones: ["0381 452-4434", "0381 421-4627"], emails: ["dirsuperior@educaciontuc.gov.ar"], services: ["Formación docente inicial", "Formación docente continua", "Tecnicaturas superiores", "Educación artística", "Apoyo pedagógico a escuelas"], aliases: ["Dirección de Educación Superior", "superior", "institutos superiores"], lastVerified: verified, notes: "La fuente oficial vigente ubica esta Dirección en Av. Sarmiento 850; no se verificó que funcione dentro de CIIDEPT." }
  },
  {
    id: "titulos", title: "Departamento de Gestión de Títulos y Certificados de Estudios", category: "Títulos y certificados",
    summary: "Gestiona certificación, legalización y registro de títulos y certificados. Ofrece consultas de títulos, constancias, estado de trámites, validez nacional y solicitudes digitales.",
    officialUrl: "https://www.educaciontuc.gov.ar/departamento-de-titulos/index.html",
    metadata: { recordType: "organization", emails: ["consultaspublicas.titulos@hotmail.com"], openingHours: "Lunes a viernes de 08:00 a 18:00", services: ["Consulta de títulos", "Consulta de constancias", "Estado de trámites", "Validez nacional", "Solicitud y validación de certificados", "SIGETIC"], aliases: ["título", "certificado de estudios", "SIGETIC", "estado de título", "legalización"], lastVerified: verified, notes: "La página institucional consultada no publica dirección ni teléfono." }
  },
  {
    id: "expedientes", title: "Consulta pública de expedientes", category: "Expedientes",
    summary: "Acceso oficial para consultar el estado de un expediente. La consulta puede requerir datos propios del trámite; DocenteTuc no los solicita ni los almacena.",
    officialUrl: "https://sime.educaciontuc.gov.ar/ConsultaExpediente/Index",
    metadata: { recordType: "system", access: "public", services: ["Consulta por número de expediente", "Código de repartición", "Letra de expediente", "Año de inicio"], aliases: ["expediente", "estado de expediente", "consulta expediente", "número de expediente"], lastVerified: verified, notes: "La consulta pública muestra iniciador, fecha de inicio, tema, tipo de expediente y oficina cuando encuentra el trámite." }
  },
  {
    id: "sinide", title: "SInIDE — Gestión Escolar", category: "Gestión escolar",
    summary: "Sistema Integral de Información Digital Educativa para la gestión administrativa y académica institucional. En 2026 se implementa en establecimientos de educación obligatoria con usuarios definidos por rol.",
    officialUrl: "https://www.educaciontuc.gov.ar/sinide/index.html",
    metadata: { recordType: "system", services: ["Gestión institucional", "Inscripciones", "Asistencia", "Promoción", "Boletines digitales", "Información nominal y estadística"], access: "private", aliases: ["SInIDE", "SGE", "gestión escolar", "carga de alumnos", "directivos", "preceptores"], lastVerified: verified, notes: "El acceso corresponde principalmente a equipos institucionales y usuarios habilitados por rol." }
  },
  {
    id: "sime", title: "SIME — Sistema Integrado del Ministerio de Educación", category: "Trámites",
    summary: "Portal personal para trámites, inscripción, situación docente, licencias y servicios administrativos. DocenteTuc no solicita ni almacena sus credenciales.",
    officialUrl: "https://sime.educaciontuc.gov.ar/",
    metadata: { recordType: "system", services: ["Cuenta docente", "Trámites", "Licencias", "Vacantes y postulaciones", "Certificaciones", "Guía de trámites"], access: "private", aliases: ["SIME", "cómo hago un trámite", "licencia", "situación docente", "cuenta docente"], lastVerified: verified }
  },
  {
    id: "licencias", title: "Licencias y salud laboral", category: "Licencias y salud laboral",
    summary: "Las licencias se gestionan administrativamente mediante SIME y, cuando corresponde, requieren constancia o evaluación de SESOP. DocenteTuc no brinda orientación médica.",
    officialUrl: "https://sime.educaciontuc.gov.ar/GuiaTramites/",
    metadata: { recordType: "procedure", services: ["Presentación administrativa de licencias", "Formularios de Dirección de Personal", "Constancias SESOP"], aliases: ["licencia", "salud laboral", "SESOP", "familiar enfermo", "aptitud física"], lastVerified: verified, sourceStatus: "partial", notes: "No se encontró en las fuentes consultadas un directorio vigente y completo de SESOP con teléfono, correo y horario; se omiten esos datos." }
  },
  {
    id: "juntas", title: "Juntas de Clasificación", category: "Juntas",
    summary: "Existen cuatro Juntas: Inicial y Primaria; Secundaria; Técnica, Agrotécnica y Formación Profesional; Superior, Especial y Artística y Organismos de Apoyo. Sus padrones, comunicados y llamados abiertos ya están integrados en DocenteTuc.",
    officialUrl: "https://task.educaciontuc.gov.ar/",
    metadata: { recordType: "organization", address: "Inicial y Primaria: Córdoba 757. Secundaria, Técnica y Superior: Av. Colón 451, San Miguel de Tucumán", phones: ["Inicial y Primaria: 0381 497-7000"], emails: ["juntaprimaria@educaciontuc.gov.ar", "juntasecundaria@educaciontuc.gov.ar", "juntatecnica@educaciontuc.gov.ar", "juntasuperior@educaciontuc.gov.ar"], services: ["Padrones", "Comunicados", "Llamados abiertos", "Propuestas de designación", "Clasificación docente"], aliases: ["Junta Secundaria", "Junta Primaria", "Junta Técnica", "Junta Superior", "papeles para junta"], lastVerified: verified, sourceStatus: "partial", notes: "El directorio oficial publica teléfono sólo para la Junta de Inicial y Primaria y no informa horarios; esos datos se omiten para las demás Juntas." }
  },
  {
    id: "empleado-publico", title: "Portal del Empleado Público", category: "Personal docente",
    summary: "Portal provincial de servicios para agentes públicos. El contenido útil verificable para docentes se deriva a los sistemas oficiales específicos como DigiTUC, SIME y la Guía de Trámites.",
    officialUrl: "https://empleadopublico.tucuman.gov.ar/",
    metadata: { recordType: "system", access: "private", aliases: ["empleado público", "portal empleado", "presentismo", "servicios del agente"], lastVerified: verified, sourceStatus: "partial", notes: "El portal no expuso contenido público indexable suficiente durante la verificación; se mantiene como acceso externo autenticado." }
  }
];

export const usefulMetadata = (value: string): UsefulMetadata | null => {
  try { const parsed = JSON.parse(value) as UsefulMetadata; return parsed?.recordType ? parsed : null; } catch { return null; }
};

