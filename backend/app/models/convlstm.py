"""
convlstm.py
-----------
ConvLSTM cell and multi-layer ConvLSTM encoder for spatiotemporal
climate grid forecasting.

Architecture:
  ConvLSTMCell  — single time-step: takes (input, hidden, cell) → (h', c')
  ConvLSTM      — processes a full sequence, returns all hidden states
"""

import torch
import torch.nn as nn
from typing import Optional, Tuple


class ConvLSTMCell(nn.Module):
    """
    A single ConvLSTM cell that applies gated convolutions over a 2-D spatial grid.

    Args:
        input_dim   : Number of input channels (e.g. 2 for temp + rain)
        hidden_dim  : Number of hidden/output feature channels
        kernel_size : Convolutional kernel size (default 3)
        bias        : Whether to use bias terms
    """

    def __init__(
        self,
        input_dim: int,
        hidden_dim: int,
        kernel_size: int = 3,
        bias: bool = True,
    ):
        super().__init__()
        self.hidden_dim = hidden_dim
        padding = kernel_size // 2

        # Single conv projects [input || hidden] → 4 gates (i, f, g, o)
        self.conv = nn.Conv2d(
            in_channels=input_dim + hidden_dim,
            out_channels=4 * hidden_dim,
            kernel_size=kernel_size,
            padding=padding,
            bias=bias,
        )

    def forward(
        self,
        x: torch.Tensor,                              # [B, C_in, H, W]
        state: Optional[Tuple[torch.Tensor, torch.Tensor]] = None,  # (h, c)
    ) -> Tuple[torch.Tensor, torch.Tensor]:           # returns (h_new, c_new)

        B, _, H, W = x.shape

        if state is None:
            h = torch.zeros(B, self.hidden_dim, H, W, device=x.device, dtype=x.dtype)
            c = torch.zeros(B, self.hidden_dim, H, W, device=x.device, dtype=x.dtype)
        else:
            h, c = state

        combined = torch.cat([x, h], dim=1)           # [B, C_in+hidden, H, W]
        gates = self.conv(combined)                   # [B, 4*hidden, H, W]

        i, f, g, o = gates.chunk(4, dim=1)
        i = torch.sigmoid(i)   # input gate
        f = torch.sigmoid(f)   # forget gate
        g = torch.tanh(g)      # cell gate
        o = torch.sigmoid(o)   # output gate

        c_new = f * c + i * g
        h_new = o * torch.tanh(c_new)

        return h_new, c_new

    def init_hidden(self, batch_size: int, height: int, width: int, device: torch.device):
        return (
            torch.zeros(batch_size, self.hidden_dim, height, width, device=device),
            torch.zeros(batch_size, self.hidden_dim, height, width, device=device),
        )


class ConvLSTM(nn.Module):
    """
    Multi-layer ConvLSTM that processes a full temporal sequence.

    Args:
        input_dim   : Input channels
        hidden_dims : List of hidden channel sizes per layer (one cell per layer)
        kernel_size : Kernel size (shared across all layers)
        bias        : Bias flag
    """

    def __init__(
        self,
        input_dim: int,
        hidden_dims: list,
        kernel_size: int = 3,
        bias: bool = True,
    ):
        super().__init__()
        self.num_layers = len(hidden_dims)

        self.cells = nn.ModuleList()
        current_dim = input_dim
        for h_dim in hidden_dims:
            self.cells.append(ConvLSTMCell(current_dim, h_dim, kernel_size, bias))
            current_dim = h_dim

    def forward(
        self,
        x: torch.Tensor,  # [B, T, C, H, W]
    ) -> Tuple[torch.Tensor, list]:
        """
        Returns:
            last_hidden : final hidden state of the last layer  [B, hidden_dims[-1], H, W]
            all_states  : list of (h, c) final states per layer
        """
        B, T, C, H, W = x.shape

        # Initialize hidden states for each layer
        states = [
            cell.init_hidden(B, H, W, x.device)
            for cell in self.cells
        ]

        for t in range(T):
            layer_input = x[:, t]          # [B, C, H, W]

            new_states = []
            for layer_idx, cell in enumerate(self.cells):
                h, c = cell(layer_input, states[layer_idx])
                new_states.append((h, c))
                layer_input = h             # next layer gets this layer's hidden state

            states = new_states

        last_hidden = states[-1][0]         # [B, hidden_dims[-1], H, W]
        return last_hidden, states
