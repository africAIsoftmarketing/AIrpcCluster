; RPC Cluster Worker Installer for Windows
; Inno Setup 6 Script
; 
; Prerequisites:
; - vendor/windows/rpc-server.exe (from llama.cpp releases)
; - worker-beacon/dist/rpc-worker-beacon-win.exe (built via build.sh or CI)

#define MyAppName "RPC Cluster Worker"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "rpc-cluster"
#define MyAppURL "https://github.com/rpc-cluster/rpc-cluster"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\RPCClusterWorker
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
; Output settings
OutputDir=..\..\dist
OutputBaseFilename=rpc-cluster-worker-setup-win64
; Compression
Compression=lzma2/ultra64
SolidCompression=yes
; Architecture
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Privileges
PrivilegesRequired=admin
; Appearance
WizardStyle=modern
DisableProgramGroupPage=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Worker beacon executable
Source: "..\..\worker-beacon\dist\rpc-worker-beacon-win.exe"; DestDir: "{app}"; Flags: ignoreversion
; RPC server from llama.cpp
; NOTE: You must download rpc-server.exe from llama.cpp releases and place it in vendor/windows/
; Download from: https://github.com/ggerganov/llama.cpp/releases
; Look for: llama-<version>-bin-win-noavx-x64.zip (CPU) or llama-<version>-bin-win-cuda-*.zip (CUDA)
Source: "..\..\vendor\windows\rpc-server.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\rpc-worker-beacon-win.exe"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"

[Dirs]
; Create tensor cache directory
Name: "{app}\tensor-cache"

[Run]
; Register and start services after installation
Filename: "{sys}\sc.exe"; Parameters: "create LlamaRPCServer binPath= ""{app}\rpc-server.exe -H 0.0.0.0 -p 50052 -m 0"" start= auto"; Flags: runhidden waituntilterminated; StatusMsg: "Registering RPC Server service..."
Filename: "{sys}\sc.exe"; Parameters: "description LlamaRPCServer ""llama.cpp RPC Server for distributed inference"""; Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "create LlamaRPCBeacon binPath= ""{app}\rpc-worker-beacon-win.exe"" start= auto"; Flags: runhidden waituntilterminated; StatusMsg: "Registering Beacon service..."
Filename: "{sys}\sc.exe"; Parameters: "description LlamaRPCBeacon ""RPC Cluster discovery beacon"""; Flags: runhidden waituntilterminated
; Start the services
Filename: "{sys}\sc.exe"; Parameters: "start LlamaRPCServer"; Flags: runhidden waituntilterminated; StatusMsg: "Starting RPC Server..."
Filename: "{sys}\sc.exe"; Parameters: "start LlamaRPCBeacon"; Flags: runhidden waituntilterminated; StatusMsg: "Starting Beacon..."

[UninstallRun]
; Stop and delete services before uninstall
Filename: "{sys}\sc.exe"; Parameters: "stop LlamaRPCBeacon"; Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "stop LlamaRPCServer"; Flags: runhidden waituntilterminated
; Wait for services to stop
Filename: "{sys}\timeout.exe"; Parameters: "/t 2 /nobreak"; Flags: runhidden waituntilterminated
; Delete services
Filename: "{sys}\sc.exe"; Parameters: "delete LlamaRPCBeacon"; Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "delete LlamaRPCServer"; Flags: runhidden waituntilterminated

[Code]
// Check if running on 64-bit Windows
function IsX64: Boolean;
begin
  Result := ProcessorArchitecture = paX64;
end;

// Open firewall port after installation
procedure OpenFirewallPort;
var
  ResultCode: Integer;
begin
  // Add firewall rule for RPC server port
  Exec(ExpandConstant('{sys}\netsh.exe'), 
       'advfirewall firewall add rule name="llama.cpp RPC Server" dir=in action=allow protocol=tcp localport=50052', 
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  
  // Add firewall rule for UDP discovery
  Exec(ExpandConstant('{sys}\netsh.exe'), 
       'advfirewall firewall add rule name="RPC Cluster Discovery" dir=in action=allow protocol=udp localport=5005', 
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// Remove firewall rules on uninstall
procedure RemoveFirewallRules;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\netsh.exe'), 
       'advfirewall firewall delete rule name="llama.cpp RPC Server"', 
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\netsh.exe'), 
       'advfirewall firewall delete rule name="RPC Cluster Discovery"', 
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    // Open firewall ports
    OpenFirewallPort;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    // Remove firewall rules
    RemoveFirewallRules;
  end;
end;

// Verify architecture on init
function InitializeSetup(): Boolean;
begin
  Result := True;
  if not IsX64 then
  begin
    MsgBox('This installer requires 64-bit Windows.', mbError, MB_OK);
    Result := False;
  end;
end;

// CODE SIGNING (Optional)
// Uncomment and configure the following section to sign the installer
// You will need to set the WIN_SIGNING_CERT environment variable
//
// [Setup]
// SignTool=signtool
//
// To use signtool, run Inno Setup Compiler with:
// ISCC.exe /Ssigntool="signtool sign /f %1 /p $env:WIN_SIGNING_CERT_PASSWORD /t http://timestamp.digicert.com $f" setup.iss
