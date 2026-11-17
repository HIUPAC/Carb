[Code]
const ParticleCount = 18;
var
  ParticleDots: array[0..17] of TLabel;
  ParticleX, ParticleY, ParticleSpeed: array[0..17] of Integer;
  ParticleTimer: Longword;

function SetTimer(hWnd, nIDEvent, uElapse, lpTimerFunc: Longword): Longword;
  external 'SetTimer@user32.dll stdcall';
function KillTimer(hWnd, nIDEvent: Longword): Bool;
  external 'KillTimer@user32.dll stdcall';

procedure ParticleTimerProc(Arg1, Arg2, Arg3, Arg4: Longword);
var I, H: Integer;
begin
  if (WizardForm = nil) or not WizardForm.WelcomePage.Visible then exit;
  H := WizardForm.WizardBitmapImage.Height;
  if H < ScaleY(30) then exit;
  for I := 0 to ParticleCount - 1 do begin
    ParticleY[I] := ParticleY[I] - ParticleSpeed[I];
    if ParticleY[I] < ScaleY(4) then ParticleY[I] := H - ScaleY(12);
    ParticleDots[I].Top := WizardForm.WizardBitmapImage.Top + ParticleY[I];
  end;
end;

procedure InitializeWizard;
var I, W, H: Integer;
begin
  W := WizardForm.WizardBitmapImage.Width;
  H := WizardForm.WizardBitmapImage.Height;
  for I := 0 to ParticleCount - 1 do begin
    ParticleDots[I] := TLabel.Create(WizardForm);
    ParticleDots[I].Parent := WizardForm.WelcomePage;

    ParticleDots[I].Transparent := True;
    ParticleDots[I].AutoSize := True;
    ParticleDots[I].Caption := '•';
    ParticleDots[I].Font.Name := 'Segoe UI';
    ParticleDots[I].Font.Color := $00DDD1C7;
    ParticleDots[I].Font.Size := 5 + (I mod 3);
    ParticleX[I] := ScaleX(6) + ((I * 73) mod (W - ScaleX(20)));
    ParticleY[I] := ScaleY(6) + ((I * 59) mod (H - ScaleY(20)));
    ParticleSpeed[I] := 1 + (I mod 2);
    ParticleDots[I].Left := WizardForm.WizardBitmapImage.Left + ParticleX[I];
    ParticleDots[I].Top := WizardForm.WizardBitmapImage.Top + ParticleY[I];
  end;
  ParticleTimer := SetTimer(0, 0, 65, CreateCallback(@ParticleTimerProc));
end;

procedure DeinitializeSetup;
begin
  if ParticleTimer <> 0 then KillTimer(0, ParticleTimer);
end;
