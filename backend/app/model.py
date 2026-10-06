"""OceanEmbedV3 model definition — matches train_v3.py exactly, needed to load the checkpoint.

v3 adds an auxiliary D20 (20°C isotherm depth) head over v2. The forward() returns
a 4-tuple (mean, log_var, recon, d20). Callers that only need mean can ignore the rest.
"""
import math
import torch
import torch.nn as nn

from .config import N_DEPTHS


def sincos_2d(h, w, dim, dev):
    y, x = torch.meshgrid(torch.arange(h, device=dev), torch.arange(w, device=dev), indexing='ij')
    d4 = dim // 4
    omega = torch.exp(-math.log(10000) * torch.arange(d4, device=dev) / d4)
    return torch.cat([torch.sin(y[..., None]*omega), torch.cos(y[..., None]*omega),
                      torch.sin(x[..., None]*omega), torch.cos(x[..., None]*omega)], dim=-1).permute(2, 0, 1)


class ResBlock(nn.Module):
    def __init__(self, c):
        super().__init__()
        self.n1 = nn.GroupNorm(8, c); self.c1 = nn.Conv2d(c, c, 3, padding=1)
        self.n2 = nn.GroupNorm(8, c); self.c2 = nn.Conv2d(c, c, 3, padding=1)
    def forward(self, x):
        h = self.c1(nn.functional.gelu(self.n1(x)))
        h = self.c2(nn.functional.gelu(self.n2(h)))
        return x + h


class Down(nn.Module):
    def __init__(self, ci, co): super().__init__(); self.op = nn.Conv2d(ci, co, 3, stride=2, padding=1)
    def forward(self, x): return self.op(x)


class Up(nn.Module):
    def __init__(self, ci, co): super().__init__(); self.op = nn.ConvTranspose2d(ci, co, 4, stride=2, padding=1)
    def forward(self, x, size=None):
        y = self.op(x)
        if size is not None and y.shape[-2:] != size:
            y = nn.functional.interpolate(y, size=size, mode='bilinear', align_corners=False)
        return y


class CrossAttn(nn.Module):
    def __init__(self, dim, heads=8):
        super().__init__()
        self.attn = nn.MultiheadAttention(dim, heads, batch_first=True)
        self.nq = nn.LayerNorm(dim); self.nk = nn.LayerNorm(dim)
        self.mlp = nn.Sequential(nn.LayerNorm(dim), nn.Linear(dim, dim*2), nn.GELU(), nn.Linear(dim*2, dim))
    def forward(self, feat, tokens):
        B, C, H, W = feat.shape
        q = feat.flatten(2).transpose(1, 2)
        a, _ = self.attn(self.nq(q), self.nk(tokens), self.nk(tokens))
        q = q + a; q = q + self.mlp(q)
        return q.transpose(1, 2).reshape(B, C, H, W)


class OceanEmbedV3(nn.Module):
    """v3: same as v2 with an added head_d20 for 20 °C isotherm depth (thermocline)."""

    D20_MEAN = 130.0    # metres — normalisation used at training time
    D20_STD  = 40.0

    def __init__(self, n_surf=8, n_static=4, window=7,
                 base=128, embed=256, vit_layers=16, vit_heads=8, patch=8,
                 n_depths=N_DEPTHS, depth_layers=6, depth_heads=4, depth_dim=96,
                 depth_tx_chunk=512):
        super().__init__()
        self.window, self.embed, self.patch = window, embed, patch
        self.n_depths, self.depth_dim = n_depths, depth_dim
        self.depth_tx_chunk = depth_tx_chunk
        self.temporal = nn.Sequential(
            nn.Conv3d(n_surf, base, (window, 3, 3), padding=(0, 1, 1)),
            nn.GroupNorm(8, base), nn.GELU())
        self.doy_mlp = nn.Sequential(nn.Linear(2, base), nn.GELU(), nn.Linear(base, base))
        in_ch = base + n_static
        self.enc1 = nn.Sequential(nn.Conv2d(in_ch, base, 3, padding=1), ResBlock(base), ResBlock(base))
        self.d1   = Down(base, base*2)
        self.enc2 = nn.Sequential(ResBlock(base*2), ResBlock(base*2))
        self.d2   = Down(base*2, embed)
        self.enc3 = nn.Sequential(ResBlock(embed), ResBlock(embed))
        enc_layer = nn.TransformerEncoderLayer(embed, vit_heads, embed*4, batch_first=True, activation='gelu')
        self.vit  = nn.TransformerEncoder(enc_layer, vit_layers)
        self.patch_in  = nn.Conv2d(embed, embed, patch, stride=patch)
        self.patch_out = nn.ConvTranspose2d(embed, embed, patch, stride=patch)
        self.cross = CrossAttn(embed, heads=vit_heads)
        self.u1   = Up(embed, base*2);   self.dec2 = nn.Sequential(ResBlock(base*2), ResBlock(base*2))
        self.u2   = Up(base*2, base);    self.dec1 = nn.Sequential(ResBlock(base),   ResBlock(base))
        self.recon_head = nn.Conv2d(base, n_surf, 1)
        self.to_depth = nn.Conv2d(base, n_depths * depth_dim, 1)
        d_layer = nn.TransformerEncoderLayer(depth_dim, depth_heads, depth_dim*4, batch_first=True, activation='gelu')
        self.depth_tx = nn.TransformerEncoder(d_layer, depth_layers)
        self.depth_pos = nn.Parameter(torch.zeros(1, n_depths, depth_dim))
        nn.init.trunc_normal_(self.depth_pos, std=0.02)
        self.head_mean = nn.Linear(depth_dim, 1)
        self.head_lv   = nn.Linear(depth_dim, 1)
        # v3 addition: 20 °C isotherm-depth head
        self.head_d20 = nn.Sequential(
            nn.Conv2d(base, base, 3, padding=1), nn.GELU(),
            nn.Conv2d(base, 1, 1))

    def _depth_tx(self, f):
        if f.size(0) <= self.depth_tx_chunk:
            return self.depth_tx(f)
        out = []
        for i in range(0, f.size(0), self.depth_tx_chunk):
            out.append(self.depth_tx(f[i:i+self.depth_tx_chunk]))
        return torch.cat(out, dim=0)

    def forward(self, s_win, static, doy):
        B = s_win.size(0)
        x = s_win.permute(0, 2, 1, 3, 4)
        x = self.temporal(x).squeeze(2)
        x = x + self.doy_mlp(doy).unsqueeze(-1).unsqueeze(-1)
        x = torch.cat([x, static], dim=1)
        e1 = self.enc1(x)
        e2 = self.enc2(self.d1(e1))
        e3 = self.enc3(self.d2(e2))
        H, W = e3.shape[-2:]
        pH = (self.patch - H % self.patch) % self.patch
        pW = (self.patch - W % self.patch) % self.patch
        e3p = nn.functional.pad(e3, (0, pW, 0, pH))
        tok = self.patch_in(e3p)
        Hp, Wp = tok.shape[-2:]
        pe = sincos_2d(Hp, Wp, self.embed, tok.device)
        seq = (tok + pe).flatten(2).transpose(1, 2)
        seq = self.vit(seq)
        tok = seq.transpose(1, 2).reshape(B, self.embed, Hp, Wp)
        vit_map = self.patch_out(tok)[..., :H, :W]
        fused = self.cross(e3, seq) + vit_map
        d2 = self.dec2(self.u1(fused, size=e2.shape[-2:]) + e2)
        d1 = self.dec1(self.u2(d2,    size=e1.shape[-2:]) + e1)
        recon = self.recon_head(d1)
        f = self.to_depth(d1)
        Bx, _, Hh, Ww = f.shape
        f = f.view(B, self.n_depths, self.depth_dim, Hh, Ww).permute(0, 3, 4, 1, 2).contiguous()
        f = f.reshape(B*Hh*Ww, self.n_depths, self.depth_dim) + self.depth_pos
        f = self._depth_tx(f)
        mean = self.head_mean(f).squeeze(-1).view(B, Hh, Ww, self.n_depths).permute(0, 3, 1, 2)
        lv   = self.head_lv  (f).squeeze(-1).view(B, Hh, Ww, self.n_depths).permute(0, 3, 1, 2)
        d20  = self.head_d20(d1).squeeze(1)         # [B, H, W]  (standardised units)
        return mean, lv, recon, d20


# alias so existing imports keep working
OceanEmbedV2 = OceanEmbedV3
