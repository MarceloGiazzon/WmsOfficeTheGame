"""Ritmo do modo ao vivo (T3.4): faz o executor esperar o instante de cada operação no tempo do jogo.

`ponte.py ao-vivo` exporta uma partida JÁ CONCLUÍDA reproduzindo o turno: uma operação ligada ao segundo `tSeg` do jogo só é
executada `(tSeg - início do turno) / velocidade` segundos (reais) depois do começo da execução. Quem olha o corporativo vê
os documentos nascerem, avançarem e o Mapa do Armazém se encher no ritmo do turno. NÃO é streaming do navegador: o servidor
do jogo só conhece a partida (SimPartida) quando ela termina (ver docs/ponte/DEMO.md, "Ao vivo").
"""
import time

from planejador import AO_VIVO_DEPOIS


class Ritmo:
    def __init__(self, inicio_turno_seg, velocidade, relogio=time.monotonic, dormir=time.sleep):
        if not velocidade or velocidade <= 0:
            raise ValueError("a velocidade tem de ser maior que zero (ex.: 300 = um turno de 10 h dura 2 min)")
        self.t0, self.velocidade, self.relogio, self.dormir = inicio_turno_seg, velocidade, relogio, dormir
        self.comeco = None

    def __call__(self, op):
        if self.comeco is None:
            self.comeco = self.relogio()
        if op.tSeg is None or op.tSeg <= self.t0 or op.tSeg >= AO_VIVO_DEPOIS:   # antes do turno / sem tempo / o histórico final
            return
        espera = (op.tSeg - self.t0) / self.velocidade - (self.relogio() - self.comeco)
        if espera > 0:
            self.dormir(espera)
