{
  description = "Vicinae form extension for writing quick markdown and Org-mode notes";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

    # Own pin: vicinae.cachix only has builds against upstream's nixpkgs pin,
    # so following ours would compile Vicinae locally.
    vicinae.url = "github:vicinaehq/vicinae";
  };

  outputs =
    inputs@{
      self,
      nixpkgs,
      vicinae,
      ...
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
      packageFor =
        system:
        (pkgsFor system).callPackage ./nix/package.nix {
          inherit (vicinae.lib.${system}) mkVicinaeExtension;
        };
    in
    {
      packages = forAllSystems (system: {
        default = packageFor system;
        quick-note = packageFor system;
      });

      checks = forAllSystems (system: {
        default = packageFor system;
      });

      homeManagerModules.default = {
        key = "vicinae-quick-notes";
        imports = [ (import ./nix/module.nix { inherit inputs; }) ];
      };

      formatter = forAllSystems (system: (pkgsFor system).nixfmt-tree);
    };
}
