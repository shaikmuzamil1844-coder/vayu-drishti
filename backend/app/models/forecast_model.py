"""
forecast_model.py
-----------------
Full VAYU-DRISHTI forecasting model.

Architecture:
  ConvLSTM Encoder → Batch Norm → Conv2D Decoder → Output Grid

Input:  [B, T=5, C=2, H=31, W=31]  (temp + rain sequence)
Output: [B, C=2, H=31, W=31]       (predicted next-frame temp + rain)
"""

import torch
import torch.nn as nn
from app.models.convlstm import ConvLSTM


class VayuDrishtiForecaster(nn.Module):
    """
    End-to-end spatiotemporal climate forecasting model.

    Args:
        in_channels  : Number of input climate variables (default 2: temp, rain)
        hidden_dims  : ConvLSTM hidden channel progression
        kernel_size  : Convolutional kernel size
    """

    def __init__(
        self,
        in_channels: int = 2,
        hidden_dims: list = None,
        kernel_size: int = 3,
    ):
        super().__init__()

        if hidden_dims is None:
            hidden_dims = [32, 64, 32]

        # Spatiotemporal encoder
        self.encoder = ConvLSTM(
            input_dim=in_channels,
            hidden_dims=hidden_dims,
            kernel_size=kernel_size,
        )

        # Normalisation after encoder
        self.bn = nn.BatchNorm2d(hidden_dims[-1])

        # Decoder: compress feature maps → output channels
        self.decoder = nn.Sequential(
            nn.Conv2d(hidden_dims[-1], 16, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(16, in_channels, kernel_size=1),   # 1×1 projection
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x : [B, T, C, H, W]  — normalized input sequence
        Returns:
            pred : [B, C, H, W]   — predicted next-frame grid
        """
        last_hidden, _ = self.encoder(x)   # [B, hidden_dims[-1], H, W]
        features = self.bn(last_hidden)
        pred = self.decoder(features)      # [B, C, H, W]
        return pred


def build_model(device: str = "cpu") -> VayuDrishtiForecaster:
    """Factory that creates and moves model to the target device."""
    model = VayuDrishtiForecaster(
        in_channels=2,
        hidden_dims=[32, 64, 32],
        kernel_size=3,
    )
    return model.to(device)
