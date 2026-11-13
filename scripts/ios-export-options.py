import datetime
import json
import pathlib
import plistlib
import shutil
import subprocess
import sys

root = pathlib.Path(sys.argv[1])
team = sys.argv[2]
bundles = {
    "app": "de.melonigemelone.app",
    "autofill": "de.melonigemelone.app.autofill",
}
targets = [
    pathlib.Path.home() / "Library/MobileDevice/Provisioning Profiles",
    pathlib.Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles",
]
profiles = {}
for name, bundle in bundles.items():
    source = root / f"{name}.mobileprovision"
    data = plistlib.loads(
        subprocess.run(
            ["security", "cms", "-D", "-i", str(source)], check=True, capture_output=True
        ).stdout
    )
    entitlements = data.get("Entitlements", {})
    if (
        "iOS" not in data.get("Platform", [])
        or team not in data.get("TeamIdentifier", [])
        or entitlements.get("application-identifier") != f"{team}.{bundle}"
        or entitlements.get("get-task-allow", False)
        or "ProvisionedDevices" in data
        or data.get("ExpirationDate", datetime.datetime.min) <= datetime.datetime.now()
    ):
        raise SystemExit(f"{name}: not a valid App Store profile for {bundle}")
    for target in targets:
        target.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target / f"melon-{data['UUID']}.mobileprovision")
    profiles[bundle] = data["Name"]

(root / "profiles.json").write_text(json.dumps(profiles))
(root / "ExportOptions.plist").write_bytes(
    plistlib.dumps(
        {
            "method": "app-store-connect",
            "teamID": team,
            "signingStyle": "manual",
            "signingCertificate": "Apple Distribution",
            "provisioningProfiles": profiles,
            "uploadSymbols": True,
            "manageAppVersionAndBuildNumber": False,
        }
    )
)
