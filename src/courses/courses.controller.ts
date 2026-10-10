import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/auth.types';
import { ClassMemberGuard } from '../classes/guards/class-member.guard';
import { ClassOwnerGuard } from '../classes/guards/class-owner.guard';
import { CoursesService } from './courses.service';
import { CourseAccessGuard } from './guards/course-access.guard';
import { CourseClassOwnerGuard } from './guards/course-class-owner.guard';
import { CourseCtx } from './decorators/course-context.decorator';
import { CourseAccessContext } from './courses.types';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  // POST /classes/:classId/courses — owner/co-owner uniquement
  // Note : ClassMemberGuard + ClassOwnerGuard vérifient l'appartenance à la
  // classe et le rôle avant même que le service soit appelé.
  @Post('classes/:classId/courses')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ClassMemberGuard, ClassOwnerGuard)
  create(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: CreateCourseDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.coursesService.create(classId, dto, user.userId);
  }

  // GET /classes/:classId/courses — filtré par rôle (PROFESSOR → ses cours seulement)
  @Get('classes/:classId/courses')
  @UseGuards(ClassMemberGuard)
  findAll(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.coursesService.findAllForClass(classId, user.userId, user.role);
  }

  // GET /courses/:courseId — CourseAccessGuard vérifie l'accès + résout le rôle
  @Get('courses/:courseId')
  @UseGuards(CourseAccessGuard)
  findOne(@CourseCtx() ctx: CourseAccessContext) {
    return this.coursesService.findOne(ctx);
  }

  // PATCH /courses/:courseId — owner/co-owner de la classe uniquement
  @Patch('courses/:courseId')
  @UseGuards(CourseAccessGuard, CourseClassOwnerGuard)
  update(
    @CourseCtx() ctx: CourseAccessContext,
    @Body() dto: UpdateCourseDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.coursesService.update(ctx, dto, user.userId);
  }

  // DELETE /courses/:courseId — owner/co-owner uniquement
  @Delete('courses/:courseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CourseAccessGuard, CourseClassOwnerGuard)
  remove(@CourseCtx() ctx: CourseAccessContext, @CurrentUser() user: RequestUser) {
    return this.coursesService.remove(ctx, user.userId);
  }

  // GET /courses/:courseId/professors
  @Get('courses/:courseId/professors')
  @UseGuards(CourseAccessGuard)
  getProfessors(@CourseCtx() ctx: CourseAccessContext) {
    return this.coursesService.getProfessors(ctx.course.id);
  }

  // DELETE /courses/:courseId/professors/:professorId — owner/co-owner uniquement
  @Delete('courses/:courseId/professors/:professorId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CourseAccessGuard, CourseClassOwnerGuard)
  removeProfessor(
    @CourseCtx() ctx: CourseAccessContext,
    @Param('professorId', ParseUUIDPipe) professorId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.coursesService.removeProfessor(ctx, professorId, user.userId);
  }
}
