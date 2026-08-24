from __future__ import annotations

from typing import Annotated, NoReturn

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentAdmin, CurrentPlayer, DbSession
from app.models import CompetitionStatus, CompetitionType
from app.schemas.competitions import (
    AdminLeagueResult,
    AdminTeamDoublesResult,
    AdminTeamSingleResult,
    CompetitionCreate,
    CompetitionDetail,
    CompetitionSummary,
    CompetitionUpdate,
    LeagueCompetitionDetail,
    LeagueFixtureRead,
    LeagueResultSubmit,
    TeamCompetitionDetail,
    TeamDoublesSubmit,
    TeamEncounterRead,
    TeamSingleSubmit,
)
from app.services.competitions import (
    CompetitionConflictError,
    CompetitionForbiddenError,
    CompetitionNotFoundError,
    CompetitionValidationError,
    complete_competition,
    create_competition,
    delete_admin_league_result,
    delete_admin_team_doubles,
    delete_admin_team_single,
    delete_competition,
    get_competition_detail,
    list_competitions,
    post_admin_team_single,
    put_admin_league_result,
    put_admin_team_doubles,
    put_admin_team_single,
    submit_league_result,
    submit_team_doubles,
    submit_team_single,
    update_competition,
)

router = APIRouter(prefix="/competitions", tags=["competitions"])
admin_router = APIRouter(prefix="/admin/competitions", tags=["admin:competitions"])


def _raise_competition_error(error: Exception) -> NoReturn:
    if isinstance(error, CompetitionNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    if isinstance(error, CompetitionForbiddenError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
    if isinstance(error, CompetitionConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    if isinstance(error, CompetitionValidationError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    raise error


def _detail(
    db: DbSession,
    competition_id: int,
    *,
    actor_id: int | None,
) -> CompetitionDetail:
    try:
        return get_competition_detail(db, competition_id, actor_id=actor_id)
    except (CompetitionNotFoundError, CompetitionValidationError) as error:
        _raise_competition_error(error)


def _league_fixture(detail: CompetitionDetail, fixture_id: int) -> LeagueFixtureRead:
    if not isinstance(detail, LeagueCompetitionDetail):
        raise HTTPException(status_code=422, detail="개인 리그 대진이 아닙니다.")
    return next(fixture for fixture in detail.fixtures if fixture.id == fixture_id)


def _team_encounter(detail: CompetitionDetail, encounter_id: int) -> TeamEncounterRead:
    if not isinstance(detail, TeamCompetitionDetail):
        raise HTTPException(status_code=422, detail="단체전 대진이 아닙니다.")
    return next(encounter for encounter in detail.encounters if encounter.id == encounter_id)


@router.get("", response_model=list[CompetitionSummary])
def list_player_competitions(
    db: DbSession,
    current_player: CurrentPlayer,
    competition_status: Annotated[CompetitionStatus | None, Query(alias="status")] = None,
    competition_type: Annotated[CompetitionType | None, Query(alias="type")] = None,
) -> list[CompetitionSummary]:
    return list_competitions(
        db,
        actor_id=current_player.id,
        status=competition_status,
        competition_type=competition_type,
    )


@router.get("/{competition_id}", response_model=CompetitionDetail)
def get_player_competition(
    competition_id: int,
    db: DbSession,
    current_player: CurrentPlayer,
) -> CompetitionDetail:
    return _detail(db, competition_id, actor_id=current_player.id)


@router.post(
    "/{competition_id}/league-fixtures/{fixture_id}/result",
    response_model=LeagueFixtureRead,
)
def post_player_league_result(
    competition_id: int,
    fixture_id: int,
    payload: LeagueResultSubmit,
    db: DbSession,
    current_player: CurrentPlayer,
) -> LeagueFixtureRead:
    try:
        submit_league_result(
            db,
            competition_id=competition_id,
            fixture_id=fixture_id,
            actor=current_player,
            my_score=payload.my_score,
            opponent_score=payload.opponent_score,
        )
    except (
        CompetitionNotFoundError,
        CompetitionForbiddenError,
        CompetitionConflictError,
        CompetitionValidationError,
    ) as error:
        _raise_competition_error(error)
    return _league_fixture(_detail(db, competition_id, actor_id=current_player.id), fixture_id)


@router.post(
    "/{competition_id}/team-encounters/{encounter_id}/singles",
    response_model=TeamEncounterRead,
)
def post_player_team_single(
    competition_id: int,
    encounter_id: int,
    payload: TeamSingleSubmit,
    db: DbSession,
    current_player: CurrentPlayer,
) -> TeamEncounterRead:
    try:
        submit_team_single(
            db,
            competition_id=competition_id,
            encounter_id=encounter_id,
            actor=current_player,
            my_team_player_id=payload.my_team_player_id,
            opponent_team_player_id=payload.opponent_team_player_id,
            my_team_score=payload.my_team_score,
            opponent_team_score=payload.opponent_team_score,
        )
    except (
        CompetitionNotFoundError,
        CompetitionForbiddenError,
        CompetitionConflictError,
        CompetitionValidationError,
    ) as error:
        _raise_competition_error(error)
    return _team_encounter(_detail(db, competition_id, actor_id=current_player.id), encounter_id)


@router.post(
    "/{competition_id}/team-encounters/{encounter_id}/doubles",
    response_model=TeamEncounterRead,
)
def post_player_team_doubles(
    competition_id: int,
    encounter_id: int,
    payload: TeamDoublesSubmit,
    db: DbSession,
    current_player: CurrentPlayer,
) -> TeamEncounterRead:
    try:
        submit_team_doubles(
            db,
            competition_id=competition_id,
            encounter_id=encounter_id,
            actor=current_player,
            my_team_score=payload.my_team_score,
            opponent_team_score=payload.opponent_team_score,
        )
    except (
        CompetitionNotFoundError,
        CompetitionForbiddenError,
        CompetitionConflictError,
        CompetitionValidationError,
    ) as error:
        _raise_competition_error(error)
    return _team_encounter(_detail(db, competition_id, actor_id=current_player.id), encounter_id)


@admin_router.get("", response_model=list[CompetitionSummary])
def list_admin_competitions(
    db: DbSession,
    _admin: CurrentAdmin,
    competition_status: Annotated[CompetitionStatus | None, Query(alias="status")] = None,
    competition_type: Annotated[CompetitionType | None, Query(alias="type")] = None,
) -> list[CompetitionSummary]:
    return list_competitions(
        db,
        actor_id=None,
        status=competition_status,
        competition_type=competition_type,
    )


@admin_router.get("/{competition_id}", response_model=CompetitionDetail)
def get_admin_competition(
    competition_id: int,
    db: DbSession,
    _admin: CurrentAdmin,
) -> CompetitionDetail:
    return _detail(db, competition_id, actor_id=None)


@admin_router.post("", response_model=CompetitionDetail, status_code=status.HTTP_201_CREATED)
def post_admin_competition(
    payload: CompetitionCreate,
    db: DbSession,
    _admin: CurrentAdmin,
) -> CompetitionDetail:
    try:
        competition_id = create_competition(db, payload=payload)
    except (CompetitionConflictError, CompetitionValidationError) as error:
        _raise_competition_error(error)
    return _detail(db, competition_id, actor_id=None)


@admin_router.patch("/{competition_id}", response_model=CompetitionDetail)
def patch_admin_competition(
    competition_id: int,
    payload: CompetitionUpdate,
    db: DbSession,
    _admin: CurrentAdmin,
) -> CompetitionDetail:
    try:
        update_competition(db, competition_id=competition_id, payload=payload)
    except (
        CompetitionNotFoundError,
        CompetitionConflictError,
        CompetitionValidationError,
    ) as error:
        _raise_competition_error(error)
    return _detail(db, competition_id, actor_id=None)


@admin_router.delete("/{competition_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_competition(
    competition_id: int,
    db: DbSession,
    _admin: CurrentAdmin,
) -> Response:
    try:
        delete_competition(db, competition_id=competition_id)
    except (CompetitionNotFoundError, CompetitionConflictError) as error:
        _raise_competition_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@admin_router.post("/{competition_id}/complete", response_model=CompetitionDetail)
def post_admin_complete_competition(
    competition_id: int,
    db: DbSession,
    _admin: CurrentAdmin,
) -> CompetitionDetail:
    try:
        complete_competition(db, competition_id=competition_id)
    except (
        CompetitionNotFoundError,
        CompetitionConflictError,
        CompetitionValidationError,
    ) as error:
        _raise_competition_error(error)
    return _detail(db, competition_id, actor_id=None)


@admin_router.put(
    "/{competition_id}/league-fixtures/{fixture_id}/result",
    response_model=LeagueFixtureRead,
)
def put_admin_league_fixture_result(
    competition_id: int,
    fixture_id: int,
    payload: AdminLeagueResult,
    db: DbSession,
    _admin: CurrentAdmin,
) -> LeagueFixtureRead:
    try:
        put_admin_league_result(
            db,
            competition_id=competition_id,
            fixture_id=fixture_id,
            score1=payload.score1,
            score2=payload.score2,
            played_on=payload.played_on,
        )
    except (
        CompetitionNotFoundError,
        CompetitionConflictError,
        CompetitionValidationError,
    ) as error:
        _raise_competition_error(error)
    return _league_fixture(_detail(db, competition_id, actor_id=None), fixture_id)


@admin_router.delete(
    "/{competition_id}/league-fixtures/{fixture_id}/result",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_admin_league_fixture_result(
    competition_id: int,
    fixture_id: int,
    db: DbSession,
    _admin: CurrentAdmin,
) -> Response:
    try:
        delete_admin_league_result(
            db,
            competition_id=competition_id,
            fixture_id=fixture_id,
        )
    except (
        CompetitionNotFoundError,
        CompetitionConflictError,
        CompetitionValidationError,
    ) as error:
        _raise_competition_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@admin_router.post(
    "/{competition_id}/team-encounters/{encounter_id}/singles",
    response_model=TeamEncounterRead,
)
def post_admin_team_single_result(
    competition_id: int,
    encounter_id: int,
    payload: AdminTeamSingleResult,
    db: DbSession,
    _admin: CurrentAdmin,
) -> TeamEncounterRead:
    try:
        post_admin_team_single(
            db,
            competition_id=competition_id,
            encounter_id=encounter_id,
            team1_player_id=payload.team1_player_id,
            team2_player_id=payload.team2_player_id,
            score1=payload.score1,
            score2=payload.score2,
            played_on=payload.played_on,
        )
    except (
        CompetitionNotFoundError,
        CompetitionConflictError,
        CompetitionValidationError,
    ) as error:
        _raise_competition_error(error)
    return _team_encounter(_detail(db, competition_id, actor_id=None), encounter_id)


@admin_router.put(
    "/{competition_id}/team-singles/{single_id}",
    response_model=TeamEncounterRead,
)
def put_admin_team_single_result(
    competition_id: int,
    single_id: int,
    payload: AdminTeamSingleResult,
    db: DbSession,
    _admin: CurrentAdmin,
) -> TeamEncounterRead:
    try:
        encounter_id = put_admin_team_single(
            db,
            competition_id=competition_id,
            single_id=single_id,
            team1_player_id=payload.team1_player_id,
            team2_player_id=payload.team2_player_id,
            score1=payload.score1,
            score2=payload.score2,
            played_on=payload.played_on,
        )
    except (
        CompetitionNotFoundError,
        CompetitionConflictError,
        CompetitionValidationError,
    ) as error:
        _raise_competition_error(error)
    return _team_encounter(_detail(db, competition_id, actor_id=None), encounter_id)


@admin_router.delete(
    "/{competition_id}/team-singles/{single_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_admin_team_single_result(
    competition_id: int,
    single_id: int,
    db: DbSession,
    _admin: CurrentAdmin,
) -> Response:
    try:
        delete_admin_team_single(db, competition_id=competition_id, single_id=single_id)
    except (
        CompetitionNotFoundError,
        CompetitionConflictError,
        CompetitionValidationError,
    ) as error:
        _raise_competition_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@admin_router.put(
    "/{competition_id}/team-encounters/{encounter_id}/doubles",
    response_model=TeamEncounterRead,
)
def put_admin_team_doubles_result(
    competition_id: int,
    encounter_id: int,
    payload: AdminTeamDoublesResult,
    db: DbSession,
    admin: CurrentAdmin,
) -> TeamEncounterRead:
    try:
        put_admin_team_doubles(
            db,
            competition_id=competition_id,
            encounter_id=encounter_id,
            admin=admin,
            score1=payload.score1,
            score2=payload.score2,
            played_on=payload.played_on,
        )
    except (
        CompetitionNotFoundError,
        CompetitionConflictError,
        CompetitionValidationError,
    ) as error:
        _raise_competition_error(error)
    return _team_encounter(_detail(db, competition_id, actor_id=None), encounter_id)


@admin_router.delete(
    "/{competition_id}/team-encounters/{encounter_id}/doubles",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_admin_team_doubles_result(
    competition_id: int,
    encounter_id: int,
    db: DbSession,
    _admin: CurrentAdmin,
) -> Response:
    try:
        delete_admin_team_doubles(
            db,
            competition_id=competition_id,
            encounter_id=encounter_id,
        )
    except (
        CompetitionNotFoundError,
        CompetitionConflictError,
        CompetitionValidationError,
    ) as error:
        _raise_competition_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
