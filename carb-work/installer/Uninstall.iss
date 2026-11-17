[Code]
const
  WaitPidPrefix = '/CARBWAITPID=';
  ProcessSynchronize = $00100000;
  ProcessQueryLimitedInformation = $00001000;
  FileGenericRead = $80000000;
  FileOpenExisting = 3;
  FileNormal = $80;
  FileDirectory = $10;
  FileReparsePoint = $400;
  InvalidAttributes = $FFFFFFFF;
  InvalidHandle = $FFFFFFFF;
  FileNotFound = 2;
  PathNotFound = 3;
  WaitSignaled = 0;

function OpenProcess(Access, InheritHandle, ProcessId: LongWord): LongWord;
  external 'OpenProcess@kernel32.dll stdcall';
function EnumProcesses(var FirstProcessId: LongWord; CapacityBytes: LongWord;
  var UsedBytes: LongWord): Boolean;
  external 'K32EnumProcesses@kernel32.dll stdcall';
function QueryFullProcessImageName(ProcessHandle, Flags: LongWord;
  ImagePath: String; var ImagePathLength: LongWord): Boolean;
  external 'QueryFullProcessImageNameW@kernel32.dll stdcall';
function WaitForSingleObject(Handle, Milliseconds: LongWord): LongWord;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function CloseHandle(Handle: LongWord): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';
function GetFileAttributes(FileName: String): LongWord;
  external 'GetFileAttributesW@kernel32.dll stdcall';
function OpenExistingFile(FileName: String; Access, ShareMode, Security,
  Creation, Flags, TemplateFile: LongWord): LongWord;
  external 'CreateFileW@kernel32.dll stdcall';

function CanCreateCarbShortcut(const ShortcutPath: String): Boolean;
var
  Shell, Shortcut: Variant;
  Target: String;
begin
  Result := False;
  if WizardNoIcons then Exit;
  if not FileExists(ShortcutPath) then
  begin
    Result := True;
    Exit;
  end;
  try
    Shell := CreateOleObject('WScript.Shell');
    Shortcut := Shell.CreateShortcut(ShortcutPath);
    Target := Shortcut.TargetPath;
    Result := CompareText(Target, ExpandConstant('{app}\Carb.exe')) = 0;
  except
    Log('Could not inspect the existing shortcut at ' + ShortcutPath + ': ' + GetExceptionMessage);
  end;
  if not Result then Log('Leaving the existing shortcut at ' + ShortcutPath);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  TargetName: AnsiString;
begin
  if CurStep <> ssPostInstall then Exit;
  TargetName := ExtractFileName(ExpandConstant('{uninstallexe}'));
  if not SaveStringToFile(ExpandConstant('{app}\uninstall-target.txt'), TargetName, False) then
    RaiseException(CustomMessage('WriteUninstallTargetFailed'));
end;

function ProcessMatches(ProcessHandle: LongWord; const Executable: String): Boolean;
var
  ImagePath: String;
  ImagePathLength: LongWord;
begin
  SetLength(ImagePath, 32768);
  ImagePathLength := Length(ImagePath);
  Result := QueryFullProcessImageName(ProcessHandle, 0, ImagePath, ImagePathLength);
  if Result then
  begin
    SetLength(ImagePath, ImagePathLength);
    Result := CompareText(ImagePath, Executable) = 0;
  end;
end;

procedure WaitForUninstallCaller(const Executable: String);
var
  Index, ProcessId: Integer;
  Parameter: String;
  ProcessHandle: LongWord;
begin
  for Index := 1 to ParamCount do
  begin
    Parameter := ParamStr(Index);
    if CompareText(Copy(Parameter, 1, Length(WaitPidPrefix)), WaitPidPrefix) <> 0 then
      Continue;
    ProcessId := StrToIntDef(Copy(Parameter, Length(WaitPidPrefix) + 1, Length(Parameter)), 0);
    if ProcessId <= 0 then Exit;
    ProcessHandle := OpenProcess(ProcessSynchronize or ProcessQueryLimitedInformation, 0, ProcessId);
    if ProcessHandle = 0 then Exit;
    try
      if ProcessMatches(ProcessHandle, Executable) then
        if WaitForSingleObject(ProcessHandle, 30000) <> WaitSignaled then
          RaiseException(CustomMessage('CloseCarbFailed'));
    finally
      CloseHandle(ProcessHandle);
    end;
    Exit;
  end;
end;

function InstalledCarbRunning(const Executable: String): Boolean;
var
  ProcessIds: array of LongWord;
  Capacity, UsedBytes, Handle: LongWord;
  Index: Integer;
begin
  Capacity := 1024;
  repeat
    SetLength(ProcessIds, Capacity);
    if not EnumProcesses(ProcessIds[0], Capacity * 4, UsedBytes) then
      RaiseException(CustomMessage('CloseCarbFailed'));
    Capacity := Capacity * 2;
  until UsedBytes < Length(ProcessIds) * 4;
  Result := False;
  for Index := 0 to Integer(UsedBytes div 4) - 1 do
  begin
    Handle := OpenProcess(ProcessQueryLimitedInformation, 0, ProcessIds[Index]);
    if Handle <> 0 then
    begin
      try
        if ProcessMatches(Handle, Executable) then
        begin
          Result := True;
          Exit;
        end;
      finally
        CloseHandle(Handle);
      end;
    end;
  end;
end;

procedure CloseInstalledCarb(const Executable: String);
var
  ResultCode, Poll: Integer;
begin
  WaitForUninstallCaller(Executable);
  if not InstalledCarbRunning(Executable) then Exit;
  Log('Requesting a graceful shutdown of ' + Executable);
  if not Exec(Executable, '--carb-quit-for-uninstall "' + Executable + '"',
    ExtractFileDir(Executable), SW_HIDE, ewNoWait, ResultCode) then
    RaiseException(CustomMessage('CloseCarbFailed'));
  for Poll := 1 to 120 do
  begin
    Sleep(250);
    if not InstalledCarbRunning(Executable) then Exit;
  end;
  RaiseException(CustomMessage('CloseCarbFailed'));
end;

procedure CheckProfileLock(const DataDir: String);
var
  LockPath: String;
  Handle: LongWord;
begin
  LockPath := AddBackslash(DataDir) + 'lockfile';
  if not FileExists(LockPath) then Exit;
  Handle := OpenExistingFile(LockPath, FileGenericRead, 0, 0, FileOpenExisting, FileNormal, 0);
  if Handle = InvalidHandle then RaiseException(CustomMessage('CarbDataInUse'));
  CloseHandle(Handle);
end;

procedure RemoveCarbProfile(const Executable, DataDir: String);
var
  Attributes: LongWord;
  ResultCode, AttributeError: Integer;
begin
  Attributes := GetFileAttributes(DataDir);
  if Attributes = InvalidAttributes then
  begin
    AttributeError := DLLGetLastError;
    if (AttributeError <> FileNotFound) and (AttributeError <> PathNotFound) then
      RaiseException(FmtMessage(CustomMessage('CleanCarbPathFailed'), [DataDir]));
    Exit;
  end;
  Log('Removing the Carb profile at ' + DataDir);
  if (Attributes and FileDirectory) = 0 then
    RaiseException(FmtMessage(CustomMessage('CleanCarbPathFailed'), [DataDir]));
  { DelTree removes a directory link without traversing its target. }
  if Attributes and FileReparsePoint = 0 then
  begin
    CheckProfileLock(DataDir);
    if not Exec(Executable, '--carb-remove-credentials "' + DataDir + '"',
      ExtractFileDir(Executable), SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
      RaiseException(CustomMessage('CleanCarbCredentialsFailed'));
  end;
  if not DelTree(DataDir, True, True, True) then
    RaiseException(FmtMessage(CustomMessage('CleanCarbPathFailed'), [DataDir]));
end;

procedure RemoveRegistryTree(Root: Integer; const Key: String);
begin
  if RegKeyExists(Root, Key) and not RegDeleteKeyIncludingSubkeys(Root, Key) then
    RaiseException(FmtMessage(CustomMessage('CleanCarbRegistryFailed'), [Key]));
end;

procedure RemoveRegistryValue(Root: Integer; const Key, Name: String);
begin
  if RegValueExists(Root, Key, Name) and not RegDeleteValue(Root, Key, Name) then
    RaiseException(FmtMessage(CustomMessage('CleanCarbRegistryFailed'), [Key + '\' + Name]));
end;

procedure RemoveCarbRegistry(const Executable: String);
var
  AppModel, Notifications, FeatureUsage, MuiCache, Compatibility, ModelId: String;
begin
  ModelId := '{#CarbAppUserModelId}';
  AppModel := 'Software\Classes\AppUserModelId\' + ModelId;
  Notifications := 'Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\' + ModelId;
  FeatureUsage := 'Software\Microsoft\Windows\CurrentVersion\Explorer\FeatureUsage\';
  MuiCache := 'Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache';
  Compatibility := 'Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Compatibility Assistant\Store';
  RemoveRegistryTree(HKCU32, AppModel);
  RemoveRegistryTree(HKCU64, AppModel);
  RemoveRegistryTree(HKCU32, Notifications);
  RemoveRegistryTree(HKCU64, Notifications);
  RemoveRegistryValue(HKCU, FeatureUsage + 'AppSwitched', ModelId);
  RemoveRegistryValue(HKCU, FeatureUsage + 'AppBadgeUpdated', ModelId);
  RemoveRegistryValue(HKCU, FeatureUsage + 'AppLaunch', ModelId);
  RemoveRegistryValue(HKCU, FeatureUsage + 'ShowJumpView', ModelId);
  RemoveRegistryValue(HKCU, MuiCache, Executable + '.FriendlyAppName');
  RemoveRegistryValue(HKCU, MuiCache, Executable + '.ApplicationCompany');
  RemoveRegistryValue(HKCU, Compatibility, Executable);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Executable: String;
begin
  if CurUninstallStep <> usUninstall then Exit;
  Executable := ExpandConstant('{app}\Carb.exe');
  CloseInstalledCarb(Executable);
  RemoveCarbProfile(Executable, ExpandConstant('{#CarbDataDir}'));
  RemoveCarbRegistry(Executable);
end;
