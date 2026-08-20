from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.models import (
    Competition,
    CompetitionMember,
    CompetitionStatus,
    CompetitionTeam,
    CompetitionTeamMember,
    CompetitionType,
    LeagueFixture,
    Match,
    MatchKind,
    TeamDoublesGame,
    TeamEncounter,
    TeamSingleGame,
    User,
    UserRole,
)
from app.schemas.competitions import (
    CompetitionCreate,
    CompetitionDetail,
    CompetitionPlayer,
    CompetitionSummary,
    CompetitionTeamRead,
    CompetitionTeamSummary,
    CompetitionUpdate,
    LeagueCompetitionDetail,
    LeagueFixtureRead,
    LeagueStanding,
    TeamCompetitionDetail,
    TeamDoublesRead,
    TeamEncounterRead,
    TeamInput,
    TeamNameInput,
    TeamSingleRead,
    TeamStanding,
    team_name_key,
)
from app.services.matches import (
    DailyMatchConflictError,
    PlayerNotFoundError,
    _canonicalize,
    _classify_integrity_error,
    _ensure_pair_available,
    _ensure_players,
    seoul_today,
)


class CompetitionServiceError(Exception):
    """Base class for expected competition-domain errors."""


class CompetitionNotFoundError(CompetitionServiceError):
    pass


class CompetitionForbiddenError(CompetitionServiceError):
    pass


class CompetitionConflictError(CompetitionServiceError):
    pass


class CompetitionValidationError(CompetitionServiceError):
    pass


def round_robin_pairs(values: list[int]) -> list[list[tuple[int, int]]]:
    """Return balanced rounds where every unordered pair appears exactly once."""
    if len(values) < 2:
        return []
    slots: list[int | None] = list(values)
    if len(slots) % 2:
        slots.append(None)

    rounds: list[list[tuple[int, int]]] = []
    for _ in range(len(slots) - 1):
        pairs: list[tuple[int, int]] = []
        for index in range(len(slots) // 2):
            left = slots[index]
            right = slots[-1 - index]
            if left is not None and right is not None:
                pairs.append((min(left, right), max(left, right)))
        rounds.append(pairs)
        slots = [slots[0], slots[-1], *slots[1:-1]]
    return rounds


def _flush(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError as error:
        translated = _classify_integrity_error(error)
        db.rollback()
        if isinstance(translated, DailyMatchConflictError):
            raise CompetitionConflictError(
                "같은 날짜에는 동일한 상대와 한 경기만 기록할 수 있습니다."
            ) from error
        if isinstance(translated, PlayerNotFoundError):
            raise CompetitionValidationError("선수 정보를 확인해 주세요.") from error
        raise CompetitionConflictError("동시에 처리된 요청과 충돌했습니다.") from error


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as error:
        translated = _classify_integrity_error(error)
        db.rollback()
        if isinstance(translated, DailyMatchConflictError):
            raise CompetitionConflictError(
                "같은 날짜에는 동일한 상대와 한 경기만 기록할 수 있습니다."
            ) from error
        raise CompetitionConflictError("동시에 처리된 요청과 충돌했습니다.") from error


def _competition_or_error(
    db: Session,
    competition_id: int,
    *,
    for_update: bool = False,
) -> Competition:
    statement = select(Competition).where(Competition.id == competition_id)
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    competition = db.scalar(statement)
    if competition is None:
        raise CompetitionNotFoundError("대회를 찾을 수 없습니다.")
    return competition


def _fixture_or_error(
    db: Session,
    competition_id: int,
    fixture_id: int,
    *,
    for_update: bool = False,
) -> LeagueFixture:
    statement = select(LeagueFixture).where(
        LeagueFixture.id == fixture_id,
        LeagueFixture.competition_id == competition_id,
    )
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    fixture = db.scalar(statement)
    if fixture is None:
        raise CompetitionNotFoundError("리그 대진을 찾을 수 없습니다.")
    return fixture


def _encounter_or_error(
    db: Session,
    competition_id: int,
    encounter_id: int,
    *,
    for_update: bool = False,
) -> TeamEncounter:
    statement = select(TeamEncounter).where(
        TeamEncounter.id == encounter_id,
        TeamEncounter.competition_id == competition_id,
    )
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    encounter = db.scalar(statement)
    if encounter is None:
        raise CompetitionNotFoundError("단체전 대진을 찾을 수 없습니다.")
    return encounter


def _single_or_error(
    db: Session,
    competition_id: int,
    single_id: int,
    *,
    for_update: bool = False,
) -> tuple[TeamSingleGame, TeamEncounter]:
    statement = (
        select(TeamSingleGame, TeamEncounter)
        .join(TeamEncounter, TeamEncounter.id == TeamSingleGame.encounter_id)
        .where(
            TeamSingleGame.id == single_id,
            TeamEncounter.competition_id == competition_id,
        )
    )
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    row = db.execute(statement).one_or_none()
    if row is None:
        raise CompetitionNotFoundError("단체전 단식 결과를 찾을 수 없습니다.")
    return row[0], row[1]


def _lock_players(db: Session, player_ids: set[int]) -> dict[int, User]:
    if not player_ids:
        return {}
    players = list(
        db.scalars(
            select(User)
            .where(User.id.in_(player_ids), User.role == UserRole.PLAYER)
            .order_by(User.id)
            .with_for_update()
        )
    )
    result = {player.id: player for player in players}
    if set(result) != player_ids:
        raise CompetitionValidationError("존재하는 선수만 참가시킬 수 있습니다.")
    return result


def _competition_player(user: User) -> CompetitionPlayer:
    return CompetitionPlayer(id=user.id, username=user.username, club_rank=user.club_rank)


def _player_map(db: Session, player_ids: set[int]) -> dict[int, CompetitionPlayer]:
    if not player_ids:
        return {}
    users = db.scalars(select(User).where(User.id.in_(player_ids))).all()
    return {user.id: _competition_player(user) for user in users}


def _ensure_type(competition: Competition, expected: CompetitionType) -> None:
    if competition.type != expected:
        raise CompetitionValidationError("대회 유형과 맞지 않는 요청입니다.")


def _ensure_player_writable(competition: Competition) -> None:
    if competition.status != CompetitionStatus.ACTIVE:
        raise CompetitionConflictError("마감된 대회에는 결과를 제출할 수 없습니다.")


def _new_competition_match(
    db: Session,
    *,
    competition: Competition,
    player_a_id: int,
    player_b_id: int,
    score_a: int,
    score_b: int,
    played_on: date,
    submitted_by_id: int,
) -> Match:
    _ensure_players(db, {player_a_id, player_b_id})
    player1_id, player2_id, score1, score2 = _canonicalize(
        player_a_id, player_b_id, score_a, score_b
    )
    try:
        _ensure_pair_available(
            db,
            played_on=played_on,
            player1_id=player1_id,
            player2_id=player2_id,
        )
    except DailyMatchConflictError as error:
        raise CompetitionConflictError(
            "같은 날짜에는 동일한 상대와 한 경기만 기록할 수 있습니다."
        ) from error
    match = Match(
        competition_id=competition.id,
        player1_id=player1_id,
        player2_id=player2_id,
        score1=score1,
        score2=score2,
        kind=MatchKind.COMPETITION,
        played_on=played_on,
        submitted_by_id=submitted_by_id,
    )
    db.add(match)
    _flush(db)
    return match


def _update_competition_match(
    db: Session,
    *,
    match: Match,
    player_a_id: int,
    player_b_id: int,
    score_a: int,
    score_b: int,
    played_on: date,
    updated_by_id: int,
) -> None:
    _ensure_players(db, {player_a_id, player_b_id})
    player1_id, player2_id, score1, score2 = _canonicalize(
        player_a_id, player_b_id, score_a, score_b
    )
    try:
        _ensure_pair_available(
            db,
            played_on=played_on,
            player1_id=player1_id,
            player2_id=player2_id,
            exclude_match_id=match.id,
        )
    except DailyMatchConflictError as error:
        raise CompetitionConflictError(
            "같은 날짜에는 동일한 상대와 한 경기만 기록할 수 있습니다."
        ) from error
    match.player1_id = player1_id
    match.player2_id = player2_id
    match.score1 = score1
    match.score2 = score2
    match.played_on = played_on
    match.updated_by_id = updated_by_id
    _flush(db)


def _score_for_players(match: Match, first_player_id: int) -> tuple[int, int]:
    if match.player1_id == first_player_id:
        return match.score1, match.score2
    return match.score2, match.score1


def _competition_common(
    competition: Competition,
    *,
    completed_count: int,
    total_count: int,
) -> dict[str, object]:
    return {
        "id": competition.id,
        "name": competition.name,
        "type": competition.type,
        "status": competition.status,
        "completed_count": completed_count,
        "total_count": total_count,
        "completed_at": competition.completed_at,
        "created_at": competition.created_at,
        "updated_at": competition.updated_at,
    }


def _league_standings(
    member_ids: list[int],
    player_map: dict[int, CompetitionPlayer],
    fixture_matches: list[tuple[LeagueFixture, Match | None]],
) -> list[LeagueStanding]:
    stats: dict[int, dict[str, int]] = {
        player_id: {
            "played": 0,
            "wins": 0,
            "losses": 0,
            "sets_won": 0,
            "sets_lost": 0,
        }
        for player_id in member_ids
    }
    winners: list[tuple[int, int, int]] = []
    for fixture, match in fixture_matches:
        if match is None:
            continue
        score1, score2 = _score_for_players(match, fixture.player1_id)
        winner_id = fixture.player1_id if score1 > score2 else fixture.player2_id
        loser_id = fixture.player2_id if winner_id == fixture.player1_id else fixture.player1_id
        stats[fixture.player1_id]["played"] += 1
        stats[fixture.player2_id]["played"] += 1
        stats[winner_id]["wins"] += 1
        stats[loser_id]["losses"] += 1
        stats[fixture.player1_id]["sets_won"] += score1
        stats[fixture.player1_id]["sets_lost"] += score2
        stats[fixture.player2_id]["sets_won"] += score2
        stats[fixture.player2_id]["sets_lost"] += score1
        winners.append((fixture.player1_id, fixture.player2_id, winner_id))

    win_groups: dict[int, set[int]] = defaultdict(set)
    for player_id, values in stats.items():
        win_groups[values["wins"]].add(player_id)
    head_to_head = {player_id: 0 for player_id in member_ids}
    for player1_id, player2_id, winner_id in winners:
        group = win_groups[stats[player1_id]["wins"]]
        if player2_id in group:
            head_to_head[winner_id] += 1

    ranked: list[tuple[tuple[int, ...], tuple[int, dict[str, int]]]] = []
    for player_id, values in stats.items():
        difference = values["sets_won"] - values["sets_lost"]
        ranked.append(
            (
                (values["wins"], head_to_head[player_id], difference),
                (player_id, values),
            )
        )
    ranked.sort(key=lambda row: (player_map[row[1][0]].username.casefold(), row[1][0]))
    ranked.sort(key=lambda row: row[0], reverse=True)

    # Assign ranks using sporting keys only; the name/id ordering is display-only.
    position = 0
    previous_key: tuple[int, ...] | None = None
    result: list[LeagueStanding] = []
    for index, (key, (player_id, values)) in enumerate(ranked, start=1):
        if key != previous_key:
            position = index
            previous_key = key
        result.append(
            LeagueStanding(
                rank=position,
                player=player_map[player_id],
                played=values["played"],
                wins=values["wins"],
                losses=values["losses"],
                sets_won=values["sets_won"],
                sets_lost=values["sets_lost"],
                set_difference=values["sets_won"] - values["sets_lost"],
            )
        )
    return result


def _league_detail(
    db: Session,
    competition: Competition,
    *,
    actor_id: int | None,
) -> LeagueCompetitionDetail:
    member_ids = list(
        db.scalars(
            select(CompetitionMember.user_id)
            .where(CompetitionMember.competition_id == competition.id)
            .order_by(CompetitionMember.user_id)
        )
    )
    fixtures = list(
        db.scalars(
            select(LeagueFixture)
            .where(LeagueFixture.competition_id == competition.id)
            .order_by(LeagueFixture.round_no, LeagueFixture.order_no, LeagueFixture.id)
        )
    )
    match_ids = {fixture.match_id for fixture in fixtures if fixture.match_id is not None}
    matches = (
        {
            match.id: match
            for match in db.scalars(select(Match).where(Match.id.in_(match_ids))).all()
        }
        if match_ids
        else {}
    )
    player_ids = set(member_ids)
    player_map = _player_map(db, player_ids)
    fixture_matches = [(fixture, matches.get(fixture.match_id)) for fixture in fixtures]
    reads: list[LeagueFixtureRead] = []
    completed_count = 0
    for fixture, match in fixture_matches:
        completed = match is not None
        if completed:
            completed_count += 1
            assert match is not None
            score1, score2 = _score_for_players(match, fixture.player1_id)
            played_on = match.played_on
            winner_id = fixture.player1_id if score1 > score2 else fixture.player2_id
        else:
            score1 = score2 = None
            played_on = None
            winner_id = None
        reads.append(
            LeagueFixtureRead(
                id=fixture.id,
                round_no=fixture.round_no,
                order_no=fixture.order_no,
                player1=player_map[fixture.player1_id],
                player2=player_map[fixture.player2_id],
                score1=score1,
                score2=score2,
                played_on=played_on,
                winner_id=winner_id,
                completed=completed,
                can_submit=(
                    competition.status == CompetitionStatus.ACTIVE
                    and not completed
                    and actor_id in {fixture.player1_id, fixture.player2_id}
                ),
            )
        )
    return LeagueCompetitionDetail(
        **_competition_common(
            competition,
            completed_count=completed_count,
            total_count=len(fixtures),
        ),
        members=[player_map[player_id] for player_id in member_ids],
        standings=_league_standings(member_ids, player_map, fixture_matches),
        fixtures=reads,
    )


def _team_data(
    db: Session,
    competition: Competition,
) -> tuple[
    list[CompetitionTeam],
    dict[int, list[int]],
    list[TeamEncounter],
    dict[int, list[tuple[TeamSingleGame, Match]]],
    dict[int, TeamDoublesGame],
    dict[int, CompetitionPlayer],
]:
    teams = list(
        db.scalars(
            select(CompetitionTeam)
            .where(CompetitionTeam.competition_id == competition.id)
            .order_by(CompetitionTeam.id)
        )
    )
    member_rows = db.execute(
        select(CompetitionTeamMember.team_id, CompetitionTeamMember.user_id)
        .where(CompetitionTeamMember.competition_id == competition.id)
        .order_by(CompetitionTeamMember.team_id, CompetitionTeamMember.user_id)
    ).all()
    team_members: dict[int, list[int]] = defaultdict(list)
    for team_id, user_id in member_rows:
        team_members[team_id].append(user_id)
    encounters = list(
        db.scalars(
            select(TeamEncounter)
            .where(TeamEncounter.competition_id == competition.id)
            .order_by(TeamEncounter.round_no, TeamEncounter.order_no, TeamEncounter.id)
        )
    )
    encounter_ids = {encounter.id for encounter in encounters}
    single_rows = (
        db.execute(
            select(TeamSingleGame, Match)
            .join(Match, Match.id == TeamSingleGame.match_id)
            .where(TeamSingleGame.encounter_id.in_(encounter_ids))
            .order_by(TeamSingleGame.encounter_id, TeamSingleGame.sequence)
        ).all()
        if encounter_ids
        else []
    )
    singles: dict[int, list[tuple[TeamSingleGame, Match]]] = defaultdict(list)
    for single, match in single_rows:
        singles[single.encounter_id].append((single, match))
    doubles = (
        {
            game.encounter_id: game
            for game in db.scalars(
                select(TeamDoublesGame).where(TeamDoublesGame.encounter_id.in_(encounter_ids))
            ).all()
        }
        if encounter_ids
        else {}
    )
    player_ids = {user_id for _, user_id in member_rows}
    return teams, team_members, encounters, singles, doubles, _player_map(db, player_ids)


def _encounter_scores(
    encounter: TeamEncounter,
    singles: list[tuple[TeamSingleGame, Match]],
    doubles: TeamDoublesGame | None,
) -> tuple[int, int, bool, int | None]:
    team1_wins = 0
    team2_wins = 0
    for single, match in singles:
        score1, score2 = _score_for_players(match, single.team1_player_id)
        if score1 > score2:
            team1_wins += 1
        else:
            team2_wins += 1
    if len(singles) != 4:
        return team1_wins, team2_wins, False, None
    if team1_wins != team2_wins:
        winner = encounter.team1_id if team1_wins > team2_wins else encounter.team2_id
        return team1_wins, team2_wins, True, winner
    if doubles is None or doubles.score1 is None or doubles.score2 is None:
        return team1_wins, team2_wins, False, None
    if doubles.score1 > doubles.score2:
        team1_wins += 1
        winner = encounter.team1_id
    else:
        team2_wins += 1
        winner = encounter.team2_id
    return team1_wins, team2_wins, True, winner


def _team_standings(
    teams: list[CompetitionTeam],
    encounters: list[TeamEncounter],
    singles: dict[int, list[tuple[TeamSingleGame, Match]]],
    doubles: dict[int, TeamDoublesGame],
) -> list[TeamStanding]:
    stats = {
        team.id: {"played": 0, "wins": 0, "losses": 0, "games_won": 0, "games_lost": 0}
        for team in teams
    }
    completed_results: list[tuple[int, int, int]] = []
    for encounter in encounters:
        team1_wins, team2_wins, completed, winner_id = _encounter_scores(
            encounter, singles[encounter.id], doubles.get(encounter.id)
        )
        if not completed or winner_id is None:
            continue
        loser_id = encounter.team2_id if winner_id == encounter.team1_id else encounter.team1_id
        stats[encounter.team1_id]["played"] += 1
        stats[encounter.team2_id]["played"] += 1
        stats[winner_id]["wins"] += 1
        stats[loser_id]["losses"] += 1
        stats[encounter.team1_id]["games_won"] += team1_wins
        stats[encounter.team1_id]["games_lost"] += team2_wins
        stats[encounter.team2_id]["games_won"] += team2_wins
        stats[encounter.team2_id]["games_lost"] += team1_wins
        completed_results.append((encounter.team1_id, encounter.team2_id, winner_id))

    win_groups: dict[int, set[int]] = defaultdict(set)
    for team_id, values in stats.items():
        win_groups[values["wins"]].add(team_id)
    head_to_head = {team.id: 0 for team in teams}
    for team1_id, team2_id, winner_id in completed_results:
        if team2_id in win_groups[stats[team1_id]["wins"]]:
            head_to_head[winner_id] += 1

    team_by_id = {team.id: team for team in teams}
    ranked: list[tuple[tuple[int, ...], tuple[int, dict[str, int]]]] = []
    for team_id, values in stats.items():
        difference = values["games_won"] - values["games_lost"]
        ranked.append(((values["wins"], head_to_head[team_id], difference), (team_id, values)))
    ranked.sort(key=lambda row: (team_by_id[row[1][0]].name.casefold(), row[1][0]))
    ranked.sort(key=lambda row: row[0], reverse=True)
    result: list[TeamStanding] = []
    previous_key: tuple[int, ...] | None = None
    current_rank = 0
    for index, (key, (team_id, values)) in enumerate(ranked, start=1):
        if key != previous_key:
            current_rank = index
            previous_key = key
        result.append(
            TeamStanding(
                rank=current_rank,
                team=CompetitionTeamSummary(
                    id=team_id,
                    name=team_by_id[team_id].name,
                ),
                played=values["played"],
                wins=values["wins"],
                losses=values["losses"],
                games_won=values["games_won"],
                games_lost=values["games_lost"],
                game_difference=values["games_won"] - values["games_lost"],
            )
        )
    return result


def _team_detail(
    db: Session,
    competition: Competition,
    *,
    actor_id: int | None,
) -> TeamCompetitionDetail:
    teams, team_members, encounters, singles, doubles, player_map = _team_data(db, competition)
    team_reads = {
        team.id: CompetitionTeamRead(
            id=team.id,
            name=team.name,
            members=[player_map[user_id] for user_id in team_members[team.id]],
        )
        for team in teams
    }
    actor_team_id = next(
        (
            team_id
            for team_id, member_ids in team_members.items()
            if actor_id is not None and actor_id in member_ids
        ),
        None,
    )
    encounter_reads: list[TeamEncounterRead] = []
    completed_count = 0
    for encounter in encounters:
        single_reads: list[TeamSingleRead] = []
        used_team1: set[int] = set()
        used_team2: set[int] = set()
        for single, match in singles[encounter.id]:
            used_team1.add(single.team1_player_id)
            used_team2.add(single.team2_player_id)
            score1, score2 = _score_for_players(match, single.team1_player_id)
            single_reads.append(
                TeamSingleRead(
                    id=single.id,
                    sequence=single.sequence,
                    team1_player=player_map[single.team1_player_id],
                    team2_player=player_map[single.team2_player_id],
                    score1=score1,
                    score2=score2,
                    played_on=match.played_on,
                    winner_team_id=(encounter.team1_id if score1 > score2 else encounter.team2_id),
                )
            )
        double = doubles.get(encounter.id)
        if double is None:
            double_read = None
        else:
            double_completed = double.score1 is not None and double.score2 is not None
            double_read = TeamDoublesRead(
                id=double.id,
                team1_players=[
                    player_map[double.team1_player1_id],
                    player_map[double.team1_player2_id],
                ],
                team2_players=[
                    player_map[double.team2_player1_id],
                    player_map[double.team2_player2_id],
                ],
                score1=double.score1,
                score2=double.score2,
                played_on=double.played_on,
                winner_team_id=(
                    encounter.team1_id
                    if double_completed and double.score1 > double.score2
                    else encounter.team2_id
                    if double_completed
                    else None
                ),
                completed=double_completed,
            )
        team1_wins, team2_wins, completed, winner_id = _encounter_scores(
            encounter, singles[encounter.id], double
        )
        if completed:
            completed_count += 1
        actor_in_encounter = actor_team_id in {encounter.team1_id, encounter.team2_id}
        encounter_reads.append(
            TeamEncounterRead(
                id=encounter.id,
                round_no=encounter.round_no,
                order_no=encounter.order_no,
                team1=team_reads[encounter.team1_id],
                team2=team_reads[encounter.team2_id],
                singles=single_reads,
                doubles=double_read,
                team1_wins=team1_wins,
                team2_wins=team2_wins,
                winner_team_id=winner_id,
                completed=completed,
                available_team1_players=[
                    player_map[player_id]
                    for player_id in team_members[encounter.team1_id]
                    if player_id not in used_team1
                ],
                available_team2_players=[
                    player_map[player_id]
                    for player_id in team_members[encounter.team2_id]
                    if player_id not in used_team2
                ],
                can_submit_singles=(
                    competition.status == CompetitionStatus.ACTIVE
                    and actor_in_encounter
                    and len(single_reads) < 4
                ),
                can_submit_doubles=(
                    competition.status == CompetitionStatus.ACTIVE
                    and actor_in_encounter
                    and double is not None
                    and double.score1 is None
                ),
            )
        )
    return TeamCompetitionDetail(
        **_competition_common(
            competition,
            completed_count=completed_count,
            total_count=len(encounters),
        ),
        teams=[team_reads[team.id] for team in teams],
        standings=_team_standings(teams, encounters, singles, doubles),
        encounters=encounter_reads,
    )


def get_competition_detail(
    db: Session,
    competition_id: int,
    *,
    actor_id: int | None,
) -> CompetitionDetail:
    competition = _competition_or_error(db, competition_id)
    if competition.type == CompetitionType.LEAGUE:
        return _league_detail(db, competition, actor_id=actor_id)
    return _team_detail(db, competition, actor_id=actor_id)


def _league_summary_progress(
    db: Session,
    competition_ids: list[int],
) -> dict[int, tuple[int, int]]:
    rows = db.execute(
        select(
            LeagueFixture.competition_id,
            func.count(LeagueFixture.id),
            func.count(LeagueFixture.match_id),
        )
        .where(LeagueFixture.competition_id.in_(competition_ids))
        .group_by(LeagueFixture.competition_id)
    )
    return {
        competition_id: (int(completed_count), int(total_count))
        for competition_id, total_count, completed_count in rows
    }


@dataclass(slots=True)
class _TeamEncounterProgress:
    competition_id: int
    singles_count: int = 0
    team1_wins: int = 0
    doubles_completed: bool = False

    @property
    def completed(self) -> bool:
        return self.singles_count == 4 and (self.team1_wins != 2 or self.doubles_completed)


def _team_summary_progress(
    db: Session,
    competition_ids: list[int],
) -> dict[int, tuple[int, int]]:
    rows = db.execute(
        select(
            TeamEncounter.id,
            TeamEncounter.competition_id,
            TeamSingleGame.id,
            TeamSingleGame.team1_player_id,
            Match.player1_id,
            Match.score1,
            Match.score2,
            TeamDoublesGame.score1,
            TeamDoublesGame.score2,
        )
        .outerjoin(TeamSingleGame, TeamSingleGame.encounter_id == TeamEncounter.id)
        .outerjoin(Match, Match.id == TeamSingleGame.match_id)
        .outerjoin(TeamDoublesGame, TeamDoublesGame.encounter_id == TeamEncounter.id)
        .where(TeamEncounter.competition_id.in_(competition_ids))
        .order_by(TeamEncounter.id, TeamSingleGame.sequence)
    )
    encounters: dict[int, _TeamEncounterProgress] = {}
    for (
        encounter_id,
        competition_id,
        single_id,
        team1_player_id,
        match_player1_id,
        match_score1,
        match_score2,
        doubles_score1,
        doubles_score2,
    ) in rows:
        progress = encounters.setdefault(
            encounter_id,
            _TeamEncounterProgress(competition_id=competition_id),
        )
        if single_id is not None:
            progress.singles_count += 1
            team1_score = match_score1 if match_player1_id == team1_player_id else match_score2
            team2_score = match_score2 if match_player1_id == team1_player_id else match_score1
            if team1_score > team2_score:
                progress.team1_wins += 1
        progress.doubles_completed = doubles_score1 is not None and doubles_score2 is not None

    totals: dict[int, list[int]] = {competition_id: [0, 0] for competition_id in competition_ids}
    for encounter in encounters.values():
        totals[encounter.competition_id][1] += 1
        if encounter.completed:
            totals[encounter.competition_id][0] += 1
    return {
        competition_id: (completed_count, total_count)
        for competition_id, (completed_count, total_count) in totals.items()
    }


def list_competitions(
    db: Session,
    *,
    status: CompetitionStatus | None,
    competition_type: CompetitionType | None,
) -> list[CompetitionSummary]:
    statement = select(Competition)
    if status is not None:
        statement = statement.where(Competition.status == status)
    if competition_type is not None:
        statement = statement.where(Competition.type == competition_type)
    competitions = list(
        db.scalars(
            statement.order_by(
                (Competition.status == CompetitionStatus.ACTIVE).desc(),
                Competition.created_at.desc(),
                Competition.id.desc(),
            )
        )
    )
    # Build progress for every competition in a fixed number of queries instead
    # of rebuilding each full detail (and its standings) one competition at a time.
    progress: dict[int, tuple[int, int]] = {competition.id: (0, 0) for competition in competitions}

    league_ids = [
        competition.id for competition in competitions if competition.type == CompetitionType.LEAGUE
    ]
    if league_ids:
        progress.update(_league_summary_progress(db, league_ids))

    team_ids = [
        competition.id for competition in competitions if competition.type == CompetitionType.TEAM
    ]
    if team_ids:
        progress.update(_team_summary_progress(db, team_ids))

    return [
        CompetitionSummary(
            **_competition_common(
                competition,
                completed_count=progress[competition.id][0],
                total_count=progress[competition.id][1],
            )
        )
        for competition in competitions
    ]


def _add_league_structure(
    db: Session,
    competition: Competition,
    participant_ids: list[int],
) -> None:
    _lock_players(db, set(participant_ids))
    for player_id in participant_ids:
        db.add(CompetitionMember(competition_id=competition.id, user_id=player_id))
    for round_no, pairs in enumerate(round_robin_pairs(participant_ids), start=1):
        for order_no, (player1_id, player2_id) in enumerate(pairs, start=1):
            db.add(
                LeagueFixture(
                    competition_id=competition.id,
                    player1_id=player1_id,
                    player2_id=player2_id,
                    round_no=round_no,
                    order_no=order_no,
                )
            )


def _validate_teams(teams: list[TeamInput]) -> set[int]:
    normalized_names = [team_name_key(team.name) for team in teams]
    if len(normalized_names) != len(set(normalized_names)):
        raise CompetitionValidationError("팀 이름은 서로 달라야 합니다.")
    all_ids = [player_id for team in teams for player_id in team.member_ids]
    if len(all_ids) != len(set(all_ids)):
        raise CompetitionValidationError("한 선수는 대회에서 한 팀에만 속할 수 있습니다.")
    return set(all_ids)


def _add_team_structure(
    db: Session,
    competition: Competition,
    teams: list[TeamInput],
) -> None:
    _lock_players(db, _validate_teams(teams))
    records: list[tuple[CompetitionTeam, TeamInput]] = []
    for team_input in teams:
        team = CompetitionTeam(competition_id=competition.id, name=team_input.name)
        db.add(team)
        records.append((team, team_input))
    _flush(db)
    for team, team_input in records:
        for player_id in team_input.member_ids:
            db.add(
                CompetitionTeamMember(
                    competition_id=competition.id,
                    team_id=team.id,
                    user_id=player_id,
                )
            )
    team_ids = [team.id for team, _ in records]
    for round_no, pairs in enumerate(round_robin_pairs(team_ids), start=1):
        for order_no, (team1_id, team2_id) in enumerate(pairs, start=1):
            db.add(
                TeamEncounter(
                    competition_id=competition.id,
                    team1_id=team1_id,
                    team2_id=team2_id,
                    round_no=round_no,
                    order_no=order_no,
                )
            )


def create_competition(
    db: Session,
    *,
    payload: CompetitionCreate,
) -> int:
    competition = Competition(
        name=payload.name,
        type=payload.type,
        status=CompetitionStatus.ACTIVE,
    )
    db.add(competition)
    _flush(db)
    if payload.type == CompetitionType.LEAGUE:
        assert payload.participant_ids is not None
        _add_league_structure(db, competition, payload.participant_ids)
    else:
        assert payload.teams is not None
        _add_team_structure(db, competition, payload.teams)
    _commit(db)
    return competition.id


def _competition_has_results(db: Session, competition: Competition) -> bool:
    if competition.type == CompetitionType.LEAGUE:
        statement = select(LeagueFixture.id).where(
            LeagueFixture.competition_id == competition.id,
            LeagueFixture.match_id.is_not(None),
        )
    else:
        statement = (
            select(TeamSingleGame.id)
            .join(TeamEncounter, TeamEncounter.id == TeamSingleGame.encounter_id)
            .where(TeamEncounter.competition_id == competition.id)
        )
    return db.scalar(statement.limit(1)) is not None


def _temporary_team_names(
    competition: Competition,
    teams: list[CompetitionTeam],
    requested: list[TeamNameInput],
) -> dict[int, str]:
    reserved = {team_name_key(team.name) for team in teams}
    reserved.update(team_name_key(item.name) for item in requested)
    temporary: dict[int, str] = {}
    for team in teams:
        stem = f"__scutta_rename_{competition.id}_{team.id}"
        suffix_number = 0
        while True:
            suffix = "" if suffix_number == 0 else f"_{suffix_number}"
            candidate = f"{stem[: 64 - len(suffix)]}{suffix}"
            if team_name_key(candidate) not in reserved:
                temporary[team.id] = candidate
                reserved.add(team_name_key(candidate))
                break
            suffix_number += 1
    return temporary


def _update_team_names(
    db: Session,
    competition: Competition,
    requested: list[TeamNameInput],
) -> None:
    _ensure_type(competition, CompetitionType.TEAM)
    teams = list(
        db.scalars(
            select(CompetitionTeam)
            .where(CompetitionTeam.competition_id == competition.id)
            .order_by(CompetitionTeam.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    requested_ids = [item.id for item in requested]
    current_ids = {team.id for team in teams}
    if len(requested_ids) != len(set(requested_ids)) or set(requested_ids) != current_ids:
        raise CompetitionValidationError("현재 대회의 모든 팀 ID를 정확히 입력해 주세요.")
    normalized_names = [team_name_key(item.name) for item in requested]
    if len(normalized_names) != len(set(normalized_names)):
        raise CompetitionValidationError("팀 이름은 서로 달라야 합니다.")

    names_by_id = {item.id: item.name for item in requested}
    if all(team.name == names_by_id[team.id] for team in teams):
        return

    # Use collision-free temporary names so swaps such as A <-> B work with
    # immediate database unique constraints on every supported database.
    temporary_names = _temporary_team_names(competition, teams, requested)
    for team in teams:
        team.name = temporary_names[team.id]
    _flush(db)
    for team in teams:
        team.name = names_by_id[team.id]
    _flush(db)


def update_competition(
    db: Session,
    *,
    competition_id: int,
    payload: CompetitionUpdate,
) -> None:
    competition = _competition_or_error(db, competition_id, for_update=True)
    fields = payload.model_fields_set
    if "team_names" in fields:
        assert payload.team_names is not None
        _update_team_names(db, competition, payload.team_names)
        competition.updated_at = utc_now()
    if "name" in fields:
        assert payload.name is not None
        competition.name = payload.name
    roster_change = bool({"participant_ids", "teams"} & fields)
    if roster_change and _competition_has_results(db, competition):
        raise CompetitionConflictError("첫 결과가 제출된 뒤에는 편성을 수정할 수 없습니다.")
    if "participant_ids" in fields:
        _ensure_type(competition, CompetitionType.LEAGUE)
        assert payload.participant_ids is not None
        db.execute(delete(LeagueFixture).where(LeagueFixture.competition_id == competition.id))
        db.execute(
            delete(CompetitionMember).where(CompetitionMember.competition_id == competition.id)
        )
        _flush(db)
        _add_league_structure(db, competition, payload.participant_ids)
    if "teams" in fields:
        _ensure_type(competition, CompetitionType.TEAM)
        assert payload.teams is not None
        db.execute(delete(TeamEncounter).where(TeamEncounter.competition_id == competition.id))
        db.execute(
            delete(CompetitionTeamMember).where(
                CompetitionTeamMember.competition_id == competition.id
            )
        )
        db.execute(delete(CompetitionTeam).where(CompetitionTeam.competition_id == competition.id))
        _flush(db)
        _add_team_structure(db, competition, payload.teams)
    _commit(db)


def delete_competition(db: Session, *, competition_id: int) -> None:
    # Every competition result write takes this lock first, so deletion cannot
    # race with a result submission or correction. Competition matches must be
    # removed before the competition because their database check constraint
    # does not allow a competition match with a NULL competition_id.
    competition = _competition_or_error(db, competition_id, for_update=True)
    db.execute(delete(Match).where(Match.competition_id == competition.id))
    db.delete(competition)
    _commit(db)


def _competition_complete(db: Session, competition: Competition) -> bool:
    detail = (
        _league_detail(db, competition, actor_id=None)
        if competition.type == CompetitionType.LEAGUE
        else _team_detail(db, competition, actor_id=None)
    )
    return detail.total_count > 0 and detail.completed_count == detail.total_count


def _reopen_if_incomplete(db: Session, competition: Competition) -> None:
    if competition.status == CompetitionStatus.COMPLETED and not _competition_complete(
        db, competition
    ):
        competition.status = CompetitionStatus.ACTIVE
        competition.completed_at = None
        _flush(db)


def complete_competition(db: Session, *, competition_id: int) -> None:
    competition = _competition_or_error(db, competition_id, for_update=True)
    if not _competition_complete(db, competition):
        raise CompetitionConflictError("모든 대진의 결과가 있어야 마감할 수 있습니다.")
    if competition.status != CompetitionStatus.COMPLETED:
        competition.status = CompetitionStatus.COMPLETED
        competition.completed_at = utc_now()
        _commit(db)


def submit_league_result(
    db: Session,
    *,
    competition_id: int,
    fixture_id: int,
    actor: User,
    my_score: int,
    opponent_score: int,
) -> None:
    competition = _competition_or_error(db, competition_id, for_update=True)
    _ensure_type(competition, CompetitionType.LEAGUE)
    _ensure_player_writable(competition)
    fixture = _fixture_or_error(db, competition_id, fixture_id, for_update=True)
    if actor.id not in {fixture.player1_id, fixture.player2_id}:
        raise CompetitionForbiddenError("본인의 리그 경기만 제출할 수 있습니다.")
    if fixture.match_id is not None:
        raise CompetitionConflictError("이미 결과가 제출된 대진입니다.")
    if actor.id == fixture.player1_id:
        score1, score2 = my_score, opponent_score
    else:
        score1, score2 = opponent_score, my_score
    match = _new_competition_match(
        db,
        competition=competition,
        player_a_id=fixture.player1_id,
        player_b_id=fixture.player2_id,
        score_a=score1,
        score_b=score2,
        played_on=seoul_today(),
        submitted_by_id=actor.id,
    )
    fixture.match_id = match.id
    _commit(db)


def put_admin_league_result(
    db: Session,
    *,
    competition_id: int,
    fixture_id: int,
    admin: User,
    score1: int,
    score2: int,
    played_on: date | None,
) -> None:
    competition = _competition_or_error(db, competition_id, for_update=True)
    _ensure_type(competition, CompetitionType.LEAGUE)
    fixture = _fixture_or_error(db, competition_id, fixture_id, for_update=True)
    match = db.get(Match, fixture.match_id) if fixture.match_id is not None else None
    if match is None:
        match = _new_competition_match(
            db,
            competition=competition,
            player_a_id=fixture.player1_id,
            player_b_id=fixture.player2_id,
            score_a=score1,
            score_b=score2,
            played_on=played_on or seoul_today(),
            submitted_by_id=admin.id,
        )
        fixture.match_id = match.id
    else:
        _update_competition_match(
            db,
            match=match,
            player_a_id=fixture.player1_id,
            player_b_id=fixture.player2_id,
            score_a=score1,
            score_b=score2,
            played_on=played_on or match.played_on,
            updated_by_id=admin.id,
        )
    _commit(db)


def delete_admin_league_result(
    db: Session,
    *,
    competition_id: int,
    fixture_id: int,
) -> None:
    competition = _competition_or_error(db, competition_id, for_update=True)
    _ensure_type(competition, CompetitionType.LEAGUE)
    fixture = _fixture_or_error(db, competition_id, fixture_id, for_update=True)
    if fixture.match_id is None:
        raise CompetitionNotFoundError("삭제할 결과가 없습니다.")
    match = db.get(Match, fixture.match_id)
    fixture.match_id = None
    _flush(db)
    if match is not None:
        db.delete(match)
    _flush(db)
    _reopen_if_incomplete(db, competition)
    _commit(db)


def _team_members_for_encounter(
    db: Session,
    encounter: TeamEncounter,
) -> tuple[set[int], set[int]]:
    rows = db.execute(
        select(CompetitionTeamMember.team_id, CompetitionTeamMember.user_id)
        .where(
            CompetitionTeamMember.competition_id == encounter.competition_id,
            CompetitionTeamMember.team_id.in_({encounter.team1_id, encounter.team2_id}),
        )
        .order_by(CompetitionTeamMember.user_id)
        .with_for_update()
    ).all()
    team1 = {user_id for team_id, user_id in rows if team_id == encounter.team1_id}
    team2 = {user_id for team_id, user_id in rows if team_id == encounter.team2_id}
    if len(team1) != 4 or len(team2) != 4:
        raise CompetitionValidationError("단체전 팀 편성이 올바르지 않습니다.")
    return team1, team2


def _actor_team(
    actor_id: int,
    encounter: TeamEncounter,
    team1_members: set[int],
    team2_members: set[int],
) -> int:
    if actor_id in team1_members:
        return encounter.team1_id
    if actor_id in team2_members:
        return encounter.team2_id
    raise CompetitionForbiddenError("해당 단체전 팀원만 결과를 제출할 수 있습니다.")


def _existing_singles(
    db: Session,
    encounter_id: int,
    *,
    for_update: bool = False,
) -> list[TeamSingleGame]:
    statement = (
        select(TeamSingleGame)
        .where(TeamSingleGame.encounter_id == encounter_id)
        .order_by(TeamSingleGame.sequence)
    )
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    return list(db.scalars(statement))


def _next_sequence(singles: list[TeamSingleGame]) -> int:
    used = {single.sequence for single in singles}
    for sequence in range(1, 5):
        if sequence not in used:
            return sequence
    raise CompetitionConflictError("네 번의 단식 결과가 모두 제출되었습니다.")


def _validate_team_single_players(
    *,
    team1_player_id: int,
    team2_player_id: int,
    team1_members: set[int],
    team2_members: set[int],
    singles: list[TeamSingleGame],
    excluding_single_id: int | None = None,
) -> None:
    if team1_player_id not in team1_members or team2_player_id not in team2_members:
        raise CompetitionValidationError("각 팀에 소속된 선수를 선택해 주세요.")
    for single in singles:
        if single.id == excluding_single_id:
            continue
        if single.team1_player_id == team1_player_id:
            raise CompetitionConflictError("1팀 선수는 이미 이 대진의 단식에 출전했습니다.")
        if single.team2_player_id == team2_player_id:
            raise CompetitionConflictError("2팀 선수는 이미 이 대진의 단식에 출전했습니다.")


def _reconcile_doubles(db: Session, encounter: TeamEncounter) -> TeamDoublesGame | None:
    rows = db.execute(
        select(TeamSingleGame, Match)
        .join(Match, Match.id == TeamSingleGame.match_id)
        .where(TeamSingleGame.encounter_id == encounter.id)
        .order_by(TeamSingleGame.sequence)
    ).all()
    existing = db.scalar(
        select(TeamDoublesGame)
        .where(TeamDoublesGame.encounter_id == encounter.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    team1_losers: list[int] = []
    team2_losers: list[int] = []
    team1_wins = team2_wins = 0
    for single, match in rows:
        score1, score2 = _score_for_players(match, single.team1_player_id)
        if score1 > score2:
            team1_wins += 1
            team2_losers.append(single.team2_player_id)
        else:
            team2_wins += 1
            team1_losers.append(single.team1_player_id)
    needs_doubles = len(rows) == 4 and team1_wins == 2 and team2_wins == 2
    if not needs_doubles:
        if existing is not None:
            db.delete(existing)
            _flush(db)
        return None

    team1_losers.sort()
    team2_losers.sort()
    desired = (*team1_losers, *team2_losers)
    current = (
        (
            existing.team1_player1_id,
            existing.team1_player2_id,
            existing.team2_player1_id,
            existing.team2_player2_id,
        )
        if existing is not None
        else None
    )
    if current == desired:
        return existing
    if existing is not None:
        db.delete(existing)
        _flush(db)
    double = TeamDoublesGame(
        encounter_id=encounter.id,
        team1_player1_id=team1_losers[0],
        team1_player2_id=team1_losers[1],
        team2_player1_id=team2_losers[0],
        team2_player2_id=team2_losers[1],
    )
    db.add(double)
    _flush(db)
    return double


def _create_team_single(
    db: Session,
    *,
    competition: Competition,
    encounter: TeamEncounter,
    team1_player_id: int,
    team2_player_id: int,
    score1: int,
    score2: int,
    played_on: date,
    submitted_by_id: int,
    team1_members: set[int] | None = None,
    team2_members: set[int] | None = None,
) -> TeamSingleGame:
    if team1_members is None or team2_members is None:
        team1_members, team2_members = _team_members_for_encounter(db, encounter)
    singles = _existing_singles(db, encounter.id, for_update=True)
    _validate_team_single_players(
        team1_player_id=team1_player_id,
        team2_player_id=team2_player_id,
        team1_members=team1_members,
        team2_members=team2_members,
        singles=singles,
    )
    sequence = _next_sequence(singles)
    match = _new_competition_match(
        db,
        competition=competition,
        player_a_id=team1_player_id,
        player_b_id=team2_player_id,
        score_a=score1,
        score_b=score2,
        played_on=played_on,
        submitted_by_id=submitted_by_id,
    )
    single = TeamSingleGame(
        encounter_id=encounter.id,
        sequence=sequence,
        team1_player_id=team1_player_id,
        team2_player_id=team2_player_id,
        match_id=match.id,
    )
    db.add(single)
    _flush(db)
    _reconcile_doubles(db, encounter)
    return single


def submit_team_single(
    db: Session,
    *,
    competition_id: int,
    encounter_id: int,
    actor: User,
    my_team_player_id: int,
    opponent_team_player_id: int,
    my_team_score: int,
    opponent_team_score: int,
) -> None:
    competition = _competition_or_error(db, competition_id, for_update=True)
    _ensure_type(competition, CompetitionType.TEAM)
    _ensure_player_writable(competition)
    encounter = _encounter_or_error(db, competition_id, encounter_id, for_update=True)
    team1_members, team2_members = _team_members_for_encounter(db, encounter)
    actor_team_id = _actor_team(actor.id, encounter, team1_members, team2_members)
    if actor_team_id == encounter.team1_id:
        team1_player_id, team2_player_id = my_team_player_id, opponent_team_player_id
        score1, score2 = my_team_score, opponent_team_score
    else:
        team1_player_id, team2_player_id = opponent_team_player_id, my_team_player_id
        score1, score2 = opponent_team_score, my_team_score
    _create_team_single(
        db,
        competition=competition,
        encounter=encounter,
        team1_player_id=team1_player_id,
        team2_player_id=team2_player_id,
        score1=score1,
        score2=score2,
        played_on=seoul_today(),
        submitted_by_id=actor.id,
        team1_members=team1_members,
        team2_members=team2_members,
    )
    _commit(db)


def post_admin_team_single(
    db: Session,
    *,
    competition_id: int,
    encounter_id: int,
    admin: User,
    team1_player_id: int,
    team2_player_id: int,
    score1: int,
    score2: int,
    played_on: date | None,
) -> None:
    competition = _competition_or_error(db, competition_id, for_update=True)
    _ensure_type(competition, CompetitionType.TEAM)
    encounter = _encounter_or_error(db, competition_id, encounter_id, for_update=True)
    _create_team_single(
        db,
        competition=competition,
        encounter=encounter,
        team1_player_id=team1_player_id,
        team2_player_id=team2_player_id,
        score1=score1,
        score2=score2,
        played_on=played_on or seoul_today(),
        submitted_by_id=admin.id,
    )
    _commit(db)


def put_admin_team_single(
    db: Session,
    *,
    competition_id: int,
    single_id: int,
    admin: User,
    team1_player_id: int,
    team2_player_id: int,
    score1: int,
    score2: int,
    played_on: date | None,
) -> int:
    competition = _competition_or_error(db, competition_id, for_update=True)
    _ensure_type(competition, CompetitionType.TEAM)
    single, encounter_from_join = _single_or_error(db, competition_id, single_id, for_update=False)
    encounter = _encounter_or_error(db, competition_id, encounter_from_join.id, for_update=True)
    team1_members, team2_members = _team_members_for_encounter(db, encounter)
    singles = _existing_singles(db, encounter.id, for_update=True)
    _validate_team_single_players(
        team1_player_id=team1_player_id,
        team2_player_id=team2_player_id,
        team1_members=team1_members,
        team2_members=team2_members,
        singles=singles,
        excluding_single_id=single.id,
    )
    match = db.scalar(
        select(Match)
        .where(Match.id == single.match_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if match is None:
        raise CompetitionNotFoundError("연결된 경기 결과를 찾을 수 없습니다.")
    _update_competition_match(
        db,
        match=match,
        player_a_id=team1_player_id,
        player_b_id=team2_player_id,
        score_a=score1,
        score_b=score2,
        played_on=played_on or match.played_on,
        updated_by_id=admin.id,
    )
    single.team1_player_id = team1_player_id
    single.team2_player_id = team2_player_id
    _flush(db)
    _reconcile_doubles(db, encounter)
    _reopen_if_incomplete(db, competition)
    _commit(db)
    return encounter.id


def delete_admin_team_single(
    db: Session,
    *,
    competition_id: int,
    single_id: int,
) -> None:
    competition = _competition_or_error(db, competition_id, for_update=True)
    _ensure_type(competition, CompetitionType.TEAM)
    single, encounter_from_join = _single_or_error(db, competition_id, single_id, for_update=False)
    encounter = _encounter_or_error(db, competition_id, encounter_from_join.id, for_update=True)
    match = db.get(Match, single.match_id)
    db.delete(single)
    _flush(db)
    if match is not None:
        db.delete(match)
        _flush(db)
    _reconcile_doubles(db, encounter)
    _reopen_if_incomplete(db, competition)
    _commit(db)


def _doubles_or_error(
    db: Session,
    encounter_id: int,
    *,
    for_update: bool,
) -> TeamDoublesGame:
    statement = select(TeamDoublesGame).where(TeamDoublesGame.encounter_id == encounter_id)
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    double = db.scalar(statement)
    if double is None:
        raise CompetitionConflictError("복식 대진이 아직 생성되지 않았습니다.")
    return double


def submit_team_doubles(
    db: Session,
    *,
    competition_id: int,
    encounter_id: int,
    actor: User,
    my_team_score: int,
    opponent_team_score: int,
) -> None:
    competition = _competition_or_error(db, competition_id, for_update=True)
    _ensure_type(competition, CompetitionType.TEAM)
    _ensure_player_writable(competition)
    encounter = _encounter_or_error(db, competition_id, encounter_id, for_update=True)
    team1_members, team2_members = _team_members_for_encounter(db, encounter)
    actor_team_id = _actor_team(actor.id, encounter, team1_members, team2_members)
    double = _doubles_or_error(db, encounter.id, for_update=True)
    if double.score1 is not None:
        raise CompetitionConflictError("이미 복식 결과가 제출되었습니다.")
    if actor_team_id == encounter.team1_id:
        score1, score2 = my_team_score, opponent_team_score
    else:
        score1, score2 = opponent_team_score, my_team_score
    double.score1 = score1
    double.score2 = score2
    double.played_on = seoul_today()
    double.submitted_by_id = actor.id
    _commit(db)


def put_admin_team_doubles(
    db: Session,
    *,
    competition_id: int,
    encounter_id: int,
    admin: User,
    score1: int,
    score2: int,
    played_on: date | None,
) -> None:
    competition = _competition_or_error(db, competition_id, for_update=True)
    _ensure_type(competition, CompetitionType.TEAM)
    encounter = _encounter_or_error(db, competition_id, encounter_id, for_update=True)
    double = _doubles_or_error(db, encounter.id, for_update=True)
    was_completed = double.score1 is not None
    double.score1 = score1
    double.score2 = score2
    double.played_on = played_on or double.played_on or seoul_today()
    if was_completed:
        double.updated_by_id = admin.id
    else:
        double.submitted_by_id = admin.id
    _commit(db)


def delete_admin_team_doubles(
    db: Session,
    *,
    competition_id: int,
    encounter_id: int,
) -> None:
    competition = _competition_or_error(db, competition_id, for_update=True)
    _ensure_type(competition, CompetitionType.TEAM)
    encounter = _encounter_or_error(db, competition_id, encounter_id, for_update=True)
    double = _doubles_or_error(db, encounter.id, for_update=True)
    if double.score1 is None:
        raise CompetitionNotFoundError("삭제할 복식 결과가 없습니다.")
    double.score1 = None
    double.score2 = None
    double.played_on = None
    double.submitted_by_id = None
    double.updated_by_id = None
    _flush(db)
    _reopen_if_incomplete(db, competition)
    _commit(db)
