import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/auth.types';
import { ClassesService } from './classes.service';
import { ClassMemberGuard } from './guards/class-member.guard';
import { ClassOwnerGuard } from './guards/class-owner.guard';
import { ClassCtx } from './decorators/class-context.decorator';
import { ClassContext } from './classes.types';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { SetCoOwnerDto } from './dto/set-co-owner.dto';
import { JoinClassDto } from './dto/join-class.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  // POST /classes — tout utilisateur authentifié peut créer une classe
  @Post('classes')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateClassDto, @CurrentUser() user: RequestUser) {
    return this.classesService.create(dto, user.userId);
  }

  // GET /classes — classes du user connecté (owner, co-owner, membre)
  @Get('classes')
  findAll(@CurrentUser() user: RequestUser) {
    return this.classesService.findAllForUser(user.userId);
  }

  // POST /classes/join — rejoindre une classe via code court
  @Post('classes/join')
  @HttpCode(HttpStatus.OK)
  join(@Body() dto: JoinClassDto, @CurrentUser() user: RequestUser) {
    return this.classesService.join(dto.joinCode, user.userId);
  }

  // GET /classes/:classId — membres autorisés uniquement
  @Get('classes/:classId')
  @UseGuards(ClassMemberGuard)
  findOne(@ClassCtx() cls: ClassContext) {
    return this.classesService.findOne(cls);
  }

  // PATCH /classes/:classId — owner ou co-owner
  @Patch('classes/:classId')
  @UseGuards(ClassMemberGuard, ClassOwnerGuard)
  update(
    @ClassCtx() cls: ClassContext,
    @Body() dto: UpdateClassDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.classesService.update(cls, dto, user.userId);
  }

  // GET /classes/:classId/members?page=1&limit=20
  @Get('classes/:classId/members')
  @UseGuards(ClassMemberGuard)
  getMembers(
    @Param('classId', ParseUUIDPipe) _classId: string,
    @ClassCtx() cls: ClassContext,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.classesService.getMembers(cls.id, page, Math.min(limit, 100));
  }

  // DELETE /classes/:classId/members/:userId — owner ou co-owner
  @Delete('classes/:classId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ClassMemberGuard, ClassOwnerGuard)
  removeMember(
    @ClassCtx() cls: ClassContext,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.classesService.removeMember(cls, targetUserId, user.userId);
  }

  // POST /classes/:classId/co-owner — owner uniquement
  @Post('classes/:classId/co-owner')
  @UseGuards(ClassMemberGuard, ClassOwnerGuard)
  setCoOwner(
    @ClassCtx() cls: ClassContext,
    @Body() dto: SetCoOwnerDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.classesService.setCoOwner(cls, dto, user.userId);
  }

  // DELETE /classes/:classId/co-owner — owner uniquement
  @Delete('classes/:classId/co-owner')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ClassMemberGuard, ClassOwnerGuard)
  removeCoOwner(
    @ClassCtx() cls: ClassContext,
    @CurrentUser() user: RequestUser,
  ) {
    return this.classesService.removeCoOwner(cls, user.userId);
  }

  // POST /classes/:classId/archive — owner uniquement
  @Post('classes/:classId/archive')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ClassMemberGuard, ClassOwnerGuard)
  archive(@ClassCtx() cls: ClassContext, @CurrentUser() user: RequestUser) {
    return this.classesService.archive(cls, user.userId);
  }

  // POST /classes/:classId/restore — owner uniquement
  @Post('classes/:classId/restore')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ClassMemberGuard, ClassOwnerGuard)
  restore(@ClassCtx() cls: ClassContext, @CurrentUser() user: RequestUser) {
    return this.classesService.restore(cls, user.userId);
  }

  // GET /classes/:classId/dashboard
  @Get('classes/:classId/dashboard')
  @UseGuards(ClassMemberGuard)
  getDashboard(@ClassCtx() cls: ClassContext) {
    return this.classesService.getDashboard(cls.id);
  }
}
