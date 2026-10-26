# DocenteTuc 1.2 Pruebas en Android

La variante `preview` usa `ar.com.docentetuc.app.preview`, nombre propio y firma de depuración. No reemplaza la aplicación distribuida por Play. La compilación exige un origen HTTPS aislado; rechaza los dominios publicados de DocenteTuc y no utiliza una URL por defecto.

## Entorno necesario antes de compilar

1. Disponer de una URL HTTPS de pruebas que sirva esta revisión de 1.2 y esté vinculada exclusivamente a una D1 aislada, con usuarios sintéticos. Verificar los bindings antes de usarla. No reutilizar el Worker, la D1 ni las credenciales de producción.
2. En PowerShell, dentro de la raíz del repositorio, establecer `$env:DOCENTETUC_PREVIEW_URL` con **esa URL real**, sin rutas, parámetros ni redirección a producción.
3. Ejecutar `powershell -ExecutionPolicy Bypass -File .\android\build-apk.ps1 -Preview`. El script compila `assemblePreview` y deja el archivo en `dist/DocenteTuc-1.2-Pruebas.apk`. Sin URL válida falla antes de descargar herramientas o compilar.
4. Obtener la huella pública de la firma del APK con `.\.android-toolchain\sdk\build-tools\35.0.0\apksigner.bat verify --print-certs .\dist\DocenteTuc-1.2-Pruebas.apk`.
5. Publicar **solo en el origen de pruebas** `/.well-known/assetlinks.json` con `package_name: ar.com.docentetuc.app.preview`, relación `delegate_permission/common.handle_all_urls` y la huella SHA-256 obtenida. Comprobar HTTPS, contenido JSON y ausencia de redirecciones. La TWA muestra una pestaña personalizada si la asociación no se verifica.
6. Transferir el APK al teléfono e instalarlo junto a DocenteTuc 1.1. Comprobar que abre exclusivamente la URL aislada y que el paquete publicado sigue instalado y conserva sus datos.

El service worker y la API Web Push son los de la web 1.2. Para verificar permisos y suscripción se necesita la aplicación instalada, la D1 de pruebas con el esquema de identidad y push, y claves VAPID **de pruebas**. La recepción y apertura de una notificación real requieren autorización específica; este procedimiento no envía ninguna.
