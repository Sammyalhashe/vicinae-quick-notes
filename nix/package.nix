{
  lib,
  mkVicinaeExtension,
  writeText,
  notesDir ? "/tmp/quick-notes",
  defaultFormat ? "markdown",
}:
mkVicinaeExtension {
  pname = "quick-note";
  version = "0.1.0";
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../package-lock.json
      ../tsconfig.json
      ../assets
      ../src
      ../test
    ];
  };

  postPatch = ''
    cp ${
      writeText "quick-note-config.json" (
        builtins.toJSON {
          inherit notesDir defaultFormat;
        }
      )
    } src/config.json
  '';

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    npm test
    runHook postCheck
  '';
}
