from typing import List, Dict, Optional, Any

from flask_backend.models import (
    Mutation,
    Primer,
    RestrictionSite,
    MutationPrimerSet,
    NumpyArray,
    FrontendFriendly,
    FrontendNumpyFriendly,
)


class MutationSet(FrontendNumpyFriendly):
    alt_codons: Dict[str, Mutation]
    compatibility: NumpyArray
    mut_primer_sets: List[MutationPrimerSet] = []


class MutationSetCollection(FrontendFriendly):
    rs_keys: List[str] = []
    sets: List[MutationSet] = []


class PCRReaction(FrontendFriendly):
    name: str
    forward_primer: Primer
    reverse_primer: Primer
    amplicon_size: int


class EdgePrimerPair(FrontendFriendly):
    forward: Primer
    reverse: Primer


# Protocol model
class DomesticationResult(FrontendFriendly):
    sequence_index: int = -1
    processed_sequence: str = ""
    mtk_part_left: str = ""
    mtk_part_right: str = ""
    restriction_sites: List[RestrictionSite] = []
    mutation_options: List[Mutation] = []
    edge_primers: EdgePrimerPair = EdgePrimerPair(forward=Primer(), reverse=Primer())
    mut_primers: List[MutationPrimerSet] = []
    recommended_primers: List[Primer] = []
    PCR_reactions: List[PCRReaction] = []
    custom_primers: Optional[Dict[str, Any]] = (
        None  # Store automatically designed custom primers
    )
    messages: List[str] = []
    errors: Optional[Any] = None


class MTKDomesticationProtocol(FrontendFriendly):
    result_data: Dict[int, DomesticationResult]


class SsePayload(FrontendFriendly):
    """Model for SSE step updates"""
    job_id: str
    sequence_idx: int
    step: str
    message: str
    step_progress: int
    notification_count: int = 0
    notificaation_type: str = "info"
    rs_key: Optional[str] = None
    rs_keys: Optional[List[str]] = None
    mutation_count: Optional[int] = None
    mutation_options: Optional[List[dict]] = None
    mutation_sets: Optional[MutationSetCollection] = None
    callout: Optional[str] = None
    processed_sequence: Optional[str] = None
    timestamp: Optional[int] = None
    callout: Optional[str] = None
