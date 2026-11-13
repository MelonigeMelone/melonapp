require "json"
require "yaml"

spec_path, team, profiles_path, build = ARGV
profiles = JSON.parse(File.read(profiles_path))
spec = YAML.load_file(spec_path)
{
  "melon-desktop_iOS" => "de.melonigemelone.app",
  "MelonAutoFill" => "de.melonigemelone.app.autofill"
}.each do |target, bundle|
  profile = profiles.fetch(bundle)
  spec.fetch("targets").fetch(target).fetch("info").fetch("properties")["CFBundleVersion"] = build.to_s
  settings = (spec.fetch("targets").fetch(target)["settings"] ||= {})
  base = (settings["base"] ||= {})
  base.merge!(
    "CODE_SIGN_STYLE" => "Manual",
    "CODE_SIGN_IDENTITY" => "Apple Distribution",
    "DEVELOPMENT_TEAM" => team,
    "PROVISIONING_PROFILE_SPECIFIER" => profile
  )
end
File.write(spec_path, spec.to_yaml)
