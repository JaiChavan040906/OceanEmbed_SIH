"""Pydantic request/response schemas."""
from typing import List, Optional
from pydantic import BaseModel, Field


class BBox(BaseModel):
    lon_min: float; lon_max: float; lat_min: float; lat_max: float
    n_lat: int; n_lon: int


class MetaResponse(BaseModel):
    bbox: BBox
    depths_m: List[int]
    surface_channels: List[str]
    n_dates: int
    date_min: Optional[str]
    date_max: Optional[str]
    checkpoint: str


class ProfileResponse(BaseModel):
    date: str
    lat: float; lon: float
    depths_m: List[int]
    predicted_C: List[float]
    glorys_C: List[float]
    error_C: List[float]


class ProfileAtDepthsResponse(BaseModel):
    """Arbitrary-depth query response — PCHIP-interpolated model + GLORYS
    temperatures at any depths in [0, 1000] m. `flags[i]` is one of
    ``ok`` | ``out_of_range`` | ``outside_support`` | ``no_data`` so the
    frontend can grey out invalid rows without hiding the request."""
    date: str
    lat: float; lon: float
    method: str
    standard_depths_m: List[int]
    query_depths_m: List[float]
    predicted_C: List[Optional[float]]
    glorys_C: List[Optional[float]]
    error_C: List[Optional[float]]
    flags: List[str]
    valid_depth_range_m: List[float]


class TimeSeriesResponse(BaseModel):
    lat: float; lon: float; depth_m: int
    dates: List[str]
    predicted_C: List[float]
    glorys_C: List[float]


class DepthMetric(BaseModel):
    depth_m: int
    rmse: Optional[float]
    bias: Optional[float]
    corr: Optional[float]
    n: int


class MetricsResponse(BaseModel):
    per_depth: List[DepthMetric]
    mean_rmse_C: float


class AnalysisRequest(BaseModel):
    context: str = Field(..., description='Free-form context sent verbatim to the LLM (max ~4000 chars)')
    extra_system: Optional[str] = None


class AnalysisResponse(BaseModel):
    analysis: str
    model: str


class HeatwaveSummary(BaseModel):
    date: str
    area_percent_in_mhw: float
    max_anomaly_C: Optional[float]
    mean_anomaly_C: Optional[float]
    categories: dict
    recommendations: List[str]


class HeatwaveResponse(BaseModel):
    summary: HeatwaveSummary
    llm_narrative: Optional[str] = None


class ArgoFloat(BaseModel):
    platform: str
    cycle: int
    lat: float
    lon: float
    time: str
    n_levels: int
    max_pressure_dbar: float


class ArgoProfile(BaseModel):
    platform: str
    cycle: int
    lat: float
    lon: float
    time: str
    pressures_dbar: List[float]
    temperatures_C: List[float]


class ArgoDepthMetric(BaseModel):
    depth_m: int
    rmse: Optional[float]
    bias: Optional[float]
    corr: Optional[float]
    n: int


class ArgoValidationResponse(BaseModel):
    date: str
    window_days: int
    n_argo_points: int
    confidence_score: Optional[float]
    confidence_label: str
    summary: str
    per_depth: List[ArgoDepthMetric]
    scatter: dict
