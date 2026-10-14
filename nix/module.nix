{ inputs }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.quickNotes;
  inherit (pkgs.stdenv.hostPlatform) system;
in
{
  options.programs.quickNotes = {
    enable = lib.mkEnableOption "a Vicinae form extension for writing markdown and Org-mode notes";

    notesDir = lib.mkOption {
      type = lib.types.str;
      default = "${config.home.homeDirectory}/Nextcloud/Notes/Inbox";
      defaultText = lib.literalExpression ''"''${config.home.homeDirectory}/Nextcloud/Notes/Inbox"'';
      description = "Directory the notes are written to; created if missing. Org files sync there but do not appear in the Nextcloud Notes app.";
    };

    defaultFormat = lib.mkOption {
      type = lib.types.enum [
        "markdown"
        "org"
      ];
      default = "markdown";
      description = "Initial note format when no last-used format is stored.";
    };
  };

  # Assumes the consumer already imports Vicinae's own home-manager module (e.g. home-modules' vicinae module).
  config = lib.mkIf cfg.enable {
    programs.vicinae.extensions = [
      (pkgs.callPackage ../nix/package.nix {
        inherit (inputs.vicinae.lib.${system}) mkVicinaeExtension;
        inherit (cfg) notesDir defaultFormat;
      })
    ];
  };
}
