package br.com.wmsoffice.thegame;

import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Atividade única do jogo (WebView do Capacitor). Ajustes de jogo:
 * - tela cheia imersiva (barras de status/navegação escondidas; reaparecem com um deslize na borda);
 * - conteúdo também sob o recorte (notch) da tela — o HUD deve respeitar env(safe-area-inset-*);
 * - tela sempre ligada: o turno dura ~20 min reais e o jogo quase não recebe toques enquanto simula.
 * A orientação é livre (ver android:screenOrientation no manifesto); a Activity não é recriada ao girar
 * (configChanges), então o estado da partida em JS sobrevive à rotação.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window janela = getWindow();
        janela.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            janela.getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        WindowCompat.setDecorFitsSystemWindows(janela, false);
        ativarModoImersivo();
    }

    @Override
    public void onWindowFocusChanged(boolean temFoco) {
        super.onWindowFocusChanged(temFoco);
        // O sistema devolve as barras quando a janela perde o foco (gaveta de notificações, diálogos).
        if (temFoco) {
            ativarModoImersivo();
        }
    }

    private void ativarModoImersivo() {
        Window janela = getWindow();
        WindowInsetsControllerCompat controle = WindowCompat.getInsetsController(janela, janela.getDecorView());
        controle.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controle.hide(WindowInsetsCompat.Type.systemBars());
    }
}
